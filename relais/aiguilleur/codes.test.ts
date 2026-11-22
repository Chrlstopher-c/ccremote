// Codes d'appairage créés par un nœud, sur un aiguilleur réel (127.0.0.1, base en mémoire, données de test) : même
// propriétaire, invitation en duo, refus (appareil, jeton absent ou inconnu, nœud révoqué, code expiré ou réutilisé),
// limite de codes actifs par propriétaire, présence de l'invité, journal sans code ni jeton.
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import pino from 'pino';
import { empreinteCode, nouveauCode } from '../acces/appairage.ts';
import { PlafondEchecs } from '../acces/plafond.ts';
import { CHEMIN_CODES_MEMBRE, CODES_ACTIFS_MAX_PAR_PROPRIETAIRE } from '../../commun/aiguilleur.ts';
import { ouvrirAnnuaire } from './annuaire-base.ts';
import { Annuaire } from './annuaire.ts';
import { type Aiguilleur, creerAiguilleur } from './aiguilleur.ts';
import { executerCommande } from './commande.ts';

type Genre = 'noeud' | 'appareil';
interface Membre {
  readonly id: string;
  readonly enLigne: boolean;
  readonly nom?: string;
  readonly genre?: string;
  readonly proprietaire?: string;
}
interface Identite {
  readonly id: string;
  readonly jeton: string;
  readonly proprietaire: string;
}
interface Contexte {
  readonly annuaire: Annuaire;
  readonly aiguilleur: Aiguilleur;
  readonly serveur: ReturnType<typeof Bun.serve>;
  readonly port: number;
  readonly lignes: string[];
  readonly sockets: WebSocket[];
}

let contexte: Contexte | null = null;

function monter(): Contexte {
  const lignes: string[] = [];
  const journal = pino({ level: 'trace' }, { write: (s: string) => void lignes.push(s) });
  const annuaire = new Annuaire(ouvrirAnnuaire(':memory:'));
  const plafond = new PlafondEchecs(join(mkdtempSync(join(tmpdir(), 'codes-essai-')), 'echecs.json'), journal);
  const aiguilleur = creerAiguilleur({ annuaire, journal, plafond });
  const serveur = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: aiguilleur.fetch,
    websocket: aiguilleur.websocket,
  });
  return { annuaire, aiguilleur, serveur, port: serveur.port ?? 0, lignes, sockets: [] };
}

function ici(): Contexte {
  if (!contexte) throw new Error('aiguilleur non démarré');
  return contexte;
}

function genererCle(): string {
  return randomBytes(32).toString('base64url');
}

function url(chemin: string): string {
  return `http://127.0.0.1:${ici().port}${chemin}`;
}

async function demander(jeton: string | null, corps: unknown): Promise<Response> {
  const entetes: Record<string, string> = { 'content-type': 'application/json' };
  if (jeton !== null) entetes['authorization'] = `Bearer ${jeton}`;
  return fetch(url(CHEMIN_CODES_MEMBRE), { method: 'POST', headers: entetes, body: JSON.stringify(corps) });
}

async function appairer(code: string, genre: Genre, nom: string): Promise<Response> {
  return fetch(url('/api/membres/appairer'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code, nom, genre, cle: genererCle() }),
  });
}

async function appairerOk(code: string, genre: Genre, nom: string): Promise<Identite> {
  const rep = await appairer(code, genre, nom);
  expect(rep.status).toBe(200);
  return (await rep.json()) as Identite;
}

/** Un membre du propriétaire, appairé par une commande locale puis l'échange HTTP. */
async function membre(proprietaire: string, genre: Genre = 'noeud'): Promise<Identite> {
  const code = executerCommande(['appairer', proprietaire], ici().annuaire).split('\n')[0] ?? '';
  return appairerOk(code, genre, `${proprietaire}-${genre}`);
}

async function creerCode(jeton: string, corps: unknown = { genre: 'meme_proprietaire' }): Promise<string> {
  const rep = await demander(jeton, corps);
  expect(rep.status).toBe(200);
  return ((await rep.json()) as { code: string }).code;
}

/** Ouvre le lien d'un membre et rend la présence reçue à la connexion. */
async function connecter(jeton: string): Promise<readonly Membre[]> {
  const ws = new WebSocket(`ws://127.0.0.1:${ici().port}/aiguilleur`, {
    headers: { authorization: `Bearer ${jeton}` },
  });
  ici().sockets.push(ws);
  return new Promise((resoudre, rejeter) => {
    ws.onmessage = (e) => {
      const m = JSON.parse(String(e.data)) as { t: string; membres?: Membre[] };
      if (m.t === 'presence') resoudre(m.membres ?? []);
    };
    ws.onerror = () => rejeter(new Error('lien refusé'));
  });
}

beforeEach(() => {
  contexte = monter();
});

afterEach(() => {
  const c = ici();
  for (const ws of c.sockets) ws.close();
  c.serveur.stop(true);
  contexte = null;
});

describe('code « même propriétaire »', () => {
  test('valable 10 min ; un appareil qui le consomme rejoint le propriétaire du nœud', async () => {
    const chris = await membre('chris');
    const rep = await demander(chris.jeton, { genre: 'meme_proprietaire' });
    expect(rep.status).toBe(200);
    const { code, expireLe } = (await rep.json()) as { code: string; expireLe: string };
    const restant = Date.parse(expireLe) - Date.now();
    expect(restant).toBeGreaterThan(9.5 * 60_000);
    expect(restant).toBeLessThanOrEqual(10 * 60_000);
    const nouvel = await appairerOk(code, 'appareil', 'iphone');
    expect(nouvel.proprietaire).toBe('chris');
    expect(ici().annuaire.membre(nouvel.id)?.genre).toBe('appareil');
    expect(ici().annuaire.membres().map((m) => m.proprietaire)).toEqual(['chris', 'chris']);
  });

  test('un code réutilisé ou expiré est refusé (401)', async () => {
    const chris = await membre('chris');
    const code = await creerCode(chris.jeton);
    await appairerOk(code, 'appareil', 'premier');
    expect((await appairer(code, 'appareil', 'rejeu')).status).toBe(401);
    const perime = nouveauCode();
    ici().annuaire.creerCodeAppairage('chris', empreinteCode(perime), new Date(Date.now() - 1000).toISOString());
    expect((await appairer(perime, 'appareil', 'perime')).status).toBe(401);
  });
});

describe('invitation en duo', () => {
  test('nouveau propriétaire lié en duo, nommé à l’invitation ; l’invité ne voit aucune machine de Chris', async () => {
    const chris = await membre('chris');
    await connecter(chris.jeton);
    const code = await creerCode(chris.jeton, { genre: 'invitation_duo', nomInvite: 'Mathéo' });
    const invite = await appairerOk(code, 'noeud', 'mac-de-matheo');
    expect(invite.proprietaire).not.toBe('chris');
    expect(invite.proprietaire).toMatch(/^[a-z0-9-]{1,40}$/);
    expect(ici().annuaire.duoLie('chris', invite.proprietaire)).toBe(true);
    expect(ici().annuaire.membre(invite.id)?.nom).toBe('Mathéo');
    const vuParInvite = await connecter(invite.jeton);
    expect(vuParInvite.filter((m) => m.proprietaire === 'chris')).toEqual([]);
  });

  test('l’invitation exige un nom ; un code « même propriétaire » n’en accepte pas', async () => {
    const chris = await membre('chris');
    expect((await demander(chris.jeton, { genre: 'invitation_duo' })).status).toBe(400);
    expect((await demander(chris.jeton, { genre: 'meme_proprietaire', nomInvite: 'x' })).status).toBe(400);
  });
});

describe('qui peut créer un code', () => {
  test('un appareil ne peut pas créer de code (403)', async () => {
    const appareil = await membre('chris', 'appareil');
    expect((await demander(appareil.jeton, { genre: 'meme_proprietaire' })).status).toBe(403);
  });

  test('sans jeton, jeton inconnu ou nœud révoqué : 401, aucun code créé', async () => {
    const chris = await membre('chris');
    const corps = { genre: 'meme_proprietaire' };
    expect((await demander(null, corps)).status).toBe(401);
    expect((await demander('jeton-inconnu', corps)).status).toBe(401);
    ici().annuaire.revoquer(chris.id);
    expect((await demander(chris.jeton, corps)).status).toBe(401);
    expect(ici().annuaire.membres().length).toBe(1);
  });
});

describe('limite de codes actifs', () => {
  test(`${CODES_ACTIFS_MAX_PAR_PROPRIETAIRE} codes actifs au plus par propriétaire (429 au suivant)`, async () => {
    const chris = await membre('chris');
    const premier = await creerCode(chris.jeton);
    for (let i = 1; i < CODES_ACTIFS_MAX_PAR_PROPRIETAIRE; i++) await creerCode(chris.jeton);
    expect((await demander(chris.jeton, { genre: 'meme_proprietaire' })).status).toBe(429);
    await appairerOk(premier, 'appareil', 'iphone');
    expect((await demander(chris.jeton, { genre: 'meme_proprietaire' })).status).toBe(200);
  });

  test('les codes expirés ne comptent pas ; un autre propriétaire a sa propre limite', async () => {
    const chris = await membre('chris');
    const matheo = await membre('matheo');
    for (let i = 0; i < CODES_ACTIFS_MAX_PAR_PROPRIETAIRE; i++) {
      const perime = nouveauCode();
      ici().annuaire.creerCodeAppairage('chris', empreinteCode(perime), new Date(Date.now() - 1000).toISOString());
    }
    expect((await demander(chris.jeton, { genre: 'meme_proprietaire' })).status).toBe(200);
    for (let i = 0; i < CODES_ACTIFS_MAX_PAR_PROPRIETAIRE; i++) await creerCode(matheo.jeton);
    expect((await demander(matheo.jeton, { genre: 'meme_proprietaire' })).status).toBe(429);
  });
});

describe('journal', () => {
  test('la création et la consommation sont journalisées, jamais le code ni le jeton', async () => {
    const chris = await membre('chris');
    const code = await creerCode(chris.jeton, { genre: 'invitation_duo', nomInvite: 'Mathéo' });
    const invite = await appairerOk(code, 'noeud', 'mac');
    const journal = ici().lignes.join('\n');
    expect(journal).not.toContain(code);
    expect(journal).not.toContain(chris.jeton);
    expect(journal).not.toContain(invite.jeton);
    expect(journal).toContain('code d’appairage créé');
  });
});
