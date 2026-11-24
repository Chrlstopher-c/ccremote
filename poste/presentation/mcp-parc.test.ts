// Responsabilité : tests du serveur MCP `parc` — lancé en sous-processus (bun run), bout en bout : initialize →
// tools/list → tools/call, sur une vraie écoute du poste dont le relais est factice. Garde « jamais soi-même », socket
// absent, opération hors liste refusée par le socket. Aucune trame de réveil n'est envoyée : le relais factice la
// reçoit.
import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { createConnection } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pino from 'pino';
import { type OperationParc, OPERATIONS_PARC } from '../../commun/parc.ts';
import type { ReponseRelais } from '../../commun/modules.ts';
import { demarrerEcouteOutils, type EcouteOutils } from './ecoute-outils.ts';
import { DESCRIPTIONS_PARC } from './parc-declaration.ts';
import { argsRelais, VAR_SOCKET_OUTILS } from './socket-outils.ts';
import { VAR_SESSION_APPELANTE } from './mcp-parc.ts';

const MCP = join(import.meta.dir, 'mcp-parc.ts');
const journal = pino({ level: 'silent' });
const dossiers: string[] = [];
const arrets: (() => void)[] = [];

afterEach(() => {
  for (const arret of arrets.splice(0)) arret();
  for (const d of dossiers.splice(0)) rmSync(d, { recursive: true, force: true });
});

interface Sous {
  envoyer(message: unknown): void;
  attendre(id: number): Promise<Record<string, unknown>>;
}

/** Lance le serveur MCP `parc` ; l'environnement de l'appelante est épuré sauf demande. */
function lancer(env: Record<string, string>): Sous {
  const base: Record<string, string> = {};
  for (const [cle, valeur] of Object.entries(process.env)) {
    if (valeur !== undefined && cle !== VAR_SESSION_APPELANTE && cle !== VAR_SOCKET_OUTILS) base[cle] = valeur;
  }
  const proc = Bun.spawn([process.execPath, 'run', MCP], {
    env: { ...base, ...env },
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'ignore',
  });
  arrets.push(() => {
    try {
      process.kill(proc.pid, 'SIGKILL');
    } catch {
      // déjà arrêté : rien à faire
    }
  });
  const lignes: Record<string, unknown>[] = [];
  let tampon = '';
  const lecteur = proc.stdout.getReader();
  void (async () => {
    const decodeur = new TextDecoder();
    for (;;) {
      const { done, value } = await lecteur.read();
      if (done) return;
      tampon += decodeur.decode(value, { stream: true });
      const morceaux = tampon.split('\n');
      tampon = morceaux.pop() ?? '';
      for (const m of morceaux) if (m.trim() !== '') lignes.push(JSON.parse(m) as Record<string, unknown>);
    }
  })();
  return {
    envoyer: (message) => proc.stdin.write(`${JSON.stringify(message)}\n`),
    attendre: async (id) => {
      const limite = Date.now() + 10_000;
      for (;;) {
        const trouvee = lignes.find((l) => l['id'] === id);
        if (trouvee) return trouvee;
        if (Date.now() > limite) throw new Error(`pas de réponse à la requête ${id}`);
        await new Promise((r) => setTimeout(r, 20));
      }
    },
  };
}

async function initialiser(sous: Sous): Promise<void> {
  sous.envoyer({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } },
  });
  await sous.attendre(1);
  sous.envoyer({ jsonrpc: '2.0', method: 'notifications/initialized' });
}

async function appeler(sous: Sous, id: number, nom: string, args: unknown): Promise<Record<string, unknown>> {
  sous.envoyer({ jsonrpc: '2.0', id, method: 'tools/call', params: { name: nom, arguments: args } });
  return sous.attendre(id);
}

function texteDe(reponse: Record<string, unknown>): string {
  const resultat = reponse['result'] as { content: { text: string }[] };
  return resultat.content[0]?.text ?? '';
}

function estErreur(reponse: Record<string, unknown>): boolean {
  return (reponse['result'] as { isError?: boolean }).isError === true;
}

interface Demande {
  readonly quoi: string;
  readonly args: unknown;
}

interface Poste {
  readonly chemin: string;
  readonly demandes: Demande[];
}

/** Écoute du poste (vraie, sur un socket temporaire) ; le relais factice répond `reponse(quoi, args)`. */
function poste(reponse: (quoi: OperationParc, args: unknown) => ReponseRelais): Poste {
  const dossier = mkdtempSync(join(tmpdir(), 'mcp-parc-'));
  dossiers.push(dossier);
  const chemin = join(dossier, 'outils.sock');
  const demandes: Demande[] = [];
  const ecoute: EcouteOutils = demarrerEcouteOutils({
    chemin,
    journal,
    sessionVivante: () => false,
    relais: async (quoi, args) => {
      if (quoi.startsWith('parc_')) demandes.push({ quoi, args });
      return reponse(quoi as OperationParc, args);
    },
  });
  arrets.push(() => ecoute.arreter());
  return { chemin, demandes };
}

const LISIBLE = (quoi: OperationParc): ReponseRelais => {
  if (quoi === 'parc_machines') {
    const machine = { id: 'tour', description: 'Tour', enLigne: true, reveilPossible: false };
    return { ok: true, donnees: { machines: [machine] } };
  }
  if (quoi === 'parc_fil') {
    const evt = { type: 'message' as const, texte: 'bonjour' };
    return { ok: true, donnees: [{ seq: 1, ts: '2026-11-22T10:00:00.000Z', evt }] };
  }
  if (quoi === 'parc_reveiller') return { ok: true, donnees: { ok: true, par: 'relais' } };
  if (quoi === 'parc_ouvrir') return { ok: true, donnees: { id: 's-new', machine: 'tour' } };
  return { ok: true, donnees: {} };
};

describe('serveur MCP parc', () => {
  test('initialize : le serveur s’annonce sous le nom parc', async () => {
    const { chemin } = poste(LISIBLE);
    const sous = lancer({ [VAR_SOCKET_OUTILS]: chemin });
    sous.envoyer({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } },
    });
    expect((await sous.attendre(1))['result']).toMatchObject({ serverInfo: { name: 'parc' } });
  });

  test('tools/list : les sept outils, avec leurs descriptions', async () => {
    const { chemin } = poste(LISIBLE);
    const sous = lancer({ [VAR_SOCKET_OUTILS]: chemin });
    await initialiser(sous);
    sous.envoyer({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
    const outils = (await sous.attendre(2))['result'] as { tools: { name: string; description: string }[] };
    expect(outils.tools.map((t) => t.name).sort()).toEqual([...OPERATIONS_PARC].sort());
    for (const t of outils.tools) expect(t.description).toBe(DESCRIPTIONS_PARC[t.name as OperationParc]);
  });

  test('parc_machines et parc_fil : le relais reçoit l’opération, la sortie est en texte lisible', async () => {
    const { chemin, demandes } = poste(LISIBLE);
    const sous = lancer({ [VAR_SOCKET_OUTILS]: chemin });
    await initialiser(sous);
    expect(texteDe(await appeler(sous, 3, 'parc_machines', {}))).toContain('- tour : en ligne — Tour');
    const fil = await appeler(sous, 4, 'parc_fil', { session: 's-1', limite: 5 });
    expect(texteDe(fil)).toContain('CHRIS > bonjour');
    expect(demandes).toContainEqual({ quoi: 'parc_fil', args: { session: 's-1', limite: 5 } });
  });

  test('parc_reveiller : une demande de réveil part au relais, rien d’autre', async () => {
    const { chemin, demandes } = poste(LISIBLE);
    const sous = lancer({ [VAR_SOCKET_OUTILS]: chemin });
    await initialiser(sous);
    const reponse = await appeler(sous, 5, 'parc_reveiller', { machine: 'tour' });
    expect(texteDe(reponse)).toContain('Réveil envoyé à tour (envoyé par relais)');
    expect(demandes).toEqual([{ quoi: 'parc_reveiller', args: { machine: 'tour' } }]);
  });

  test('parc_envoyer vers une autre session : le message part, confirmé', async () => {
    const { chemin, demandes } = poste(LISIBLE);
    const sous = lancer({ [VAR_SOCKET_OUTILS]: chemin, [VAR_SESSION_APPELANTE]: 's-moi' });
    await initialiser(sous);
    const reponse = await appeler(sous, 6, 'parc_envoyer', { session: 's-autre', texte: 'salut' });
    expect(texteDe(reponse)).toContain('Message envoyé à s-autre');
    expect(demandes).toEqual([{ quoi: 'parc_envoyer', args: { session: 's-autre', texte: 'salut' } }]);
  });

  test('parc_envoyer vers la session appelante : refusé, rien ne part au relais', async () => {
    const { chemin, demandes } = poste(LISIBLE);
    const sous = lancer({ [VAR_SOCKET_OUTILS]: chemin, [VAR_SESSION_APPELANTE]: 's-moi' });
    await initialiser(sous);
    const reponse = await appeler(sous, 7, 'parc_envoyer', { session: 's-moi', texte: 'salut' });
    expect(estErreur(reponse)).toBe(true);
    expect(texteDe(reponse)).toContain('ne peut pas viser');
    expect(demandes.filter((d) => d.quoi === 'parc_envoyer')).toHaveLength(0);
  });

  test('parc_repondre vers la session appelante : refusé, rien ne part au relais', async () => {
    const { chemin, demandes } = poste(LISIBLE);
    const sous = lancer({ [VAR_SOCKET_OUTILS]: chemin, [VAR_SESSION_APPELANTE]: 's-moi' });
    await initialiser(sous);
    const reponse = await appeler(sous, 8, 'parc_repondre', { session: 's-moi', dialogue: 'd1', index: 0 });
    expect(estErreur(reponse)).toBe(true);
    expect(demandes.filter((d) => d.quoi === 'parc_repondre')).toHaveLength(0);
  });

  test('parc_ouvrir : la session créée est annoncée', async () => {
    const { chemin } = poste(LISIBLE);
    const sous = lancer({ [VAR_SOCKET_OUTILS]: chemin, [VAR_SESSION_APPELANTE]: 's-moi' });
    await initialiser(sous);
    const ouvrir = { machine: 'tour', dossier: '/mnt/projects/p', message: 'X' };
    const reponse = await appeler(sous, 9, 'parc_ouvrir', ouvrir);
    expect(texteDe(reponse)).toContain('s-new sur tour');
  });

  test('refus du relais : erreur lisible, le serveur reste vivant', async () => {
    const { chemin } = poste(() => ({ ok: false, erreur: 'session inconnue' }));
    const sous = lancer({ [VAR_SOCKET_OUTILS]: chemin });
    await initialiser(sous);
    const reponse = await appeler(sous, 10, 'parc_fil', { session: 'absente' });
    expect(estErreur(reponse)).toBe(true);
    expect(texteDe(reponse)).toBe('Échec : session inconnue');
  });

  test('socket absent : refus lisible, le serveur reste vivant', async () => {
    const dossier = mkdtempSync(join(tmpdir(), 'mcp-parc-absent-'));
    dossiers.push(dossier);
    const sous = lancer({ [VAR_SOCKET_OUTILS]: join(dossier, 'absent.sock') });
    await initialiser(sous);
    const reponse = await appeler(sous, 11, 'parc_machines', {});
    expect(texteDe(reponse)).toContain('Lanterne n’est pas en service sur cette machine');
    expect(estErreur(reponse)).toBe(true);
  });

  test('arguments invalides : rien ne part au relais', async () => {
    const { chemin, demandes } = poste(LISIBLE);
    const sous = lancer({ [VAR_SOCKET_OUTILS]: chemin });
    await initialiser(sous);
    await appeler(sous, 12, 'parc_envoyer', { session: 's-1', texte: '' });
    expect(demandes.filter((d) => d.quoi === 'parc_envoyer')).toHaveLength(0);
  });
});

describe('socket des outils du parc', () => {
  test('une opération hors liste est refusée par le poste, sans relais', async () => {
    const { chemin, demandes } = poste(LISIBLE);
    const reponse = await brut(chemin, '{"id":"r1","quoi":"parc_supprimer","args":{}}');
    expect(reponse).toContain('opération ou forme hors liste');
    expect(demandes).toHaveLength(0);
  });

  test('les arguments d’une opération du parc partent tels quels, sans session forcée', () => {
    const demande = { id: 'r', quoi: 'parc_envoyer' as const, args: { session: 's', texte: 't' } };
    expect(argsRelais(demande)).toEqual({ session: 's', texte: 't' });
  });
});

/** Une ligne brute sur le socket ; rend la première ligne de réponse. */
function brut(chemin: string, ligne: string): Promise<string> {
  return new Promise((resoudre) => {
    const s = createConnection(chemin);
    let recu = '';
    s.on('connect', () => s.write(`${ligne}\n`));
    s.on('data', (octets) => {
      recu += octets.toString('utf8');
      if (recu.includes('\n')) {
        resoudre(recu);
        s.destroy();
      }
    });
    s.on('error', () => resoudre(recu));
  });
}
