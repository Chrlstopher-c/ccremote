// Responsabilité : tests du serveur MCP externe, lancé en sous-processus (bun run) : initialize → tools/list →
// tools/call bout en bout avec une vraie écoute du poste (relais factice), socket absent, session déjà pilotée.
import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pino from 'pino';
import type { QuoiRelais, ReponseRelais } from '../../commun/modules.ts';
import { demarrerEcouteOutils, type EcouteOutils } from './ecoute-outils.ts';
import { DESCRIPTION_MODULE_APPELER, DESCRIPTION_MODULES_LISTER } from './modules-declaration.ts';
import { VAR_SESSION_PILOTEE, VAR_SOCKET_OUTILS } from './socket-outils.ts';

const MCP = join(import.meta.dir, 'mcp-externe.ts');
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

/** Lance le serveur MCP externe ; l'environnement est épuré de la variable « pilotée » sauf demande. */
function lancer(env: Record<string, string>): Sous {
  const base: Record<string, string> = {};
  for (const [cle, valeur] of Object.entries(process.env)) {
    if (valeur !== undefined && cle !== VAR_SESSION_PILOTEE && cle !== VAR_SOCKET_OUTILS) base[cle] = valeur;
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

function initialiser(sous: Sous): Promise<Record<string, unknown>> {
  sous.envoyer({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } },
  });
  return sous.attendre(1);
}

function texteDe(reponse: Record<string, unknown>): string {
  const resultat = reponse['result'] as { content: { text: string }[] };
  return resultat.content[0]?.text ?? '';
}

/** Écoute du poste (vrai, sur un socket temporaire) avec un relais factice qui enregistre ses appels. */
function poste(reponse: ReponseRelais): { chemin: string; appels: { quoi: QuoiRelais; args: unknown }[] } {
  const dossier = mkdtempSync(join(tmpdir(), 'mcp-externe-'));
  dossiers.push(dossier);
  const chemin = join(dossier, 'outils.sock');
  const appels: { quoi: QuoiRelais; args: unknown }[] = [];
  const ecoute: EcouteOutils = demarrerEcouteOutils({
    chemin,
    journal,
    sessionVivante: () => false,
    relais: async (quoi, args) => {
      appels.push({ quoi, args });
      return reponse;
    },
  });
  arrets.push(() => ecoute.arreter());
  return { chemin, appels };
}

describe('serveur MCP externe', () => {
  test('répond à initialize sans socket, et annonce les outils de modules', async () => {
    const sous = lancer({ [VAR_SOCKET_OUTILS]: '/nonexistent/outils.sock' });
    const reponse = await initialiser(sous);
    expect(reponse['result']).toMatchObject({ serverInfo: { name: 'lanterne' } });
  });

  test('tools/list : les deux outils, avec les descriptions du serveur en processus', async () => {
    const { chemin } = poste({ ok: true });
    const sous = lancer({ [VAR_SOCKET_OUTILS]: chemin });
    await initialiser(sous);
    sous.envoyer({ jsonrpc: '2.0', method: 'notifications/initialized' });
    sous.envoyer({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
    const outils = (await sous.attendre(2))['result'] as { tools: { name: string; description: string }[] };
    expect(outils.tools.map((t) => t.name)).toEqual(['modules_lister', 'module_appeler']);
    expect(outils.tools[0]?.description).toBe(DESCRIPTION_MODULES_LISTER);
    expect(outils.tools[1]?.description).toBe(DESCRIPTION_MODULE_APPELER);
  });

  test('tools/call : les deux outils passent par le socket jusqu’au relais, session null', async () => {
    const { chemin, appels } = poste({ ok: true, donnees: { modules: [{ module: 'carte' }] } });
    const sous = lancer({ [VAR_SOCKET_OUTILS]: chemin });
    await initialiser(sous);
    sous.envoyer({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'modules_lister', arguments: {} } });
    expect(texteDe(await sous.attendre(3))).toContain('carte');
    const appel = { module: 'carte', outil: 'centrer', arguments: { lat: 1 } };
    sous.envoyer({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'module_appeler', arguments: appel } });
    await sous.attendre(4);
    expect(appels).toEqual([
      { quoi: 'modules_lister', args: {} },
      { quoi: 'module_appeler', args: { module: 'carte', outil: 'centrer', arguments: { lat: 1 }, session: null } },
    ]);
  });

  test('socket absent : refus lisible, le serveur reste vivant', async () => {
    const dossier = mkdtempSync(join(tmpdir(), 'mcp-externe-absent-'));
    dossiers.push(dossier);
    const sous = lancer({ [VAR_SOCKET_OUTILS]: join(dossier, 'absent.sock') });
    await initialiser(sous);
    sous.envoyer({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'modules_lister', arguments: {} } });
    const reponse = await sous.attendre(5);
    expect(texteDe(reponse)).toContain('Lanterne n’est pas en service sur cette machine');
    expect((reponse['result'] as { isError?: boolean }).isError).toBe(true);
  });

  test('session déjà pilotée par le poste : aucun outil exposé', async () => {
    const { chemin } = poste({ ok: true });
    const sous = lancer({ [VAR_SOCKET_OUTILS]: chemin, [VAR_SESSION_PILOTEE]: '1' });
    await initialiser(sous);
    sous.envoyer({ jsonrpc: '2.0', id: 6, method: 'tools/list', params: {} });
    expect((await sous.attendre(6))['result']).toEqual({ tools: [] });
  });
});
