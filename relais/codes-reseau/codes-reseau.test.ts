// Création de code par le nœud : relais vers un aiguilleur réel (127.0.0.1, base en mémoire, données de test) avec le
// jeton du nœud, refus rendus tels quels, aiguilleur injoignable, et route de l'appli (corps validé, protection).
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import pino from 'pino';
import { PlafondEchecs } from '../acces/plafond.ts';
import { CODES_ACTIFS_MAX_PAR_PROPRIETAIRE } from '../../commun/aiguilleur.ts';
import { ouvrirAnnuaire } from '../aiguilleur/annuaire-base.ts';
import { Annuaire } from '../aiguilleur/annuaire.ts';
import { type Aiguilleur, creerAiguilleur } from '../aiguilleur/aiguilleur.ts';
import { executerCommande } from '../aiguilleur/commande.ts';
import { SecretsNoeud } from '../federation/secrets.ts';
import { routesCodesReseau } from './api-codes-reseau.ts';
import { CodesReseau } from './codes-reseau.ts';

interface Monte {
  readonly annuaire: Annuaire;
  readonly aiguilleur: Aiguilleur;
  readonly serveur: ReturnType<typeof Bun.serve>;
  readonly url: string;
  readonly dossier: string;
  readonly lignes: string[];
}

let monte: Monte | null = null;

function monterAiguilleur(): Monte {
  const lignes: string[] = [];
  const journal = pino({ level: 'trace' }, { write: (s: string) => void lignes.push(s) });
  const annuaire = new Annuaire(ouvrirAnnuaire(':memory:'));
  const dossier = mkdtempSync(join(tmpdir(), 'codes-noeud-essai-'));
  const plafond = new PlafondEchecs(join(dossier, 'echecs.json'), journal);
  const aiguilleur = creerAiguilleur({ annuaire, journal, plafond });
  const serveur = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: aiguilleur.fetch,
    websocket: aiguilleur.websocket,
  });
  return { annuaire, aiguilleur, serveur, url: `http://127.0.0.1:${serveur.port}`, dossier, lignes };
}

function ici(): Monte {
  if (!monte) throw new Error('aiguilleur non démarré');
  return monte;
}

const journal = pino({ level: 'silent' });

/** Un nœud relié : appairage par commande locale, puis secrets écrits comme le fait la liaison réelle. */
async function noeudRattache(
  m: Monte,
  proprietaire = 'chris',
): Promise<{ id: string; jeton: string; codes: CodesReseau }> {
  const code = executerCommande(['appairer', proprietaire], m.annuaire).split('\n')[0] ?? '';
  const rep = await fetch(`${m.url}/api/membres/appairer`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code, nom: 'tour', genre: 'noeud', cle: randomBytes(32).toString('base64url') }),
  });
  const { id, jeton } = (await rep.json()) as { id: string; jeton: string };
  const secrets = new SecretsNoeud(m.dossier, journal);
  secrets.ecrireAiguilleur({ url: m.url, jeton, id, nom: 'tour', proprietaire });
  return { id, jeton, codes: new CodesReseau(secrets, journal) };
}

beforeEach(() => {
  monte = monterAiguilleur();
});

afterEach(() => {
  monte?.serveur.stop(true);
  monte = null;
});

describe('relais du nœud vers l’aiguilleur', () => {
  test('non relié à un aiguilleur : 409, rien n’est demandé', async () => {
    const vide = new CodesReseau(new SecretsNoeud(mkdtempSync(join(tmpdir(), 'codes-vide-')), journal), journal);
    const r = await vide.creer({ genre: 'meme_proprietaire' });
    expect(r).toEqual({ ok: false, statut: 409, raison: expect.any(String) });
  });

  test('un code « même propriétaire » demandé par le nœud rattache un appareil à son propriétaire', async () => {
    const m = ici();
    const tour = await noeudRattache(m);
    const r = await tour.codes.creer({ genre: 'meme_proprietaire' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const rep = await fetch(`${m.url}/api/membres/appairer`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        code: r.valeur.code,
        nom: 'iphone',
        genre: 'appareil',
        cle: randomBytes(32).toString('base64url'),
      }),
    });
    expect(await rep.json()).toMatchObject({ proprietaire: 'chris' });
  });

  test('une invitation demandée par le nœud crée un propriétaire lié en duo à celui du nœud', async () => {
    const m = ici();
    const tour = await noeudRattache(m);
    const r = await tour.codes.creer({ genre: 'invitation_duo', nomInvite: 'Mathéo' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const rep = await fetch(`${m.url}/api/membres/appairer`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        code: r.valeur.code,
        nom: 'mac',
        genre: 'noeud',
        cle: randomBytes(32).toString('base64url'),
      }),
    });
    const invite = (await rep.json()) as { proprietaire: string };
    expect(m.annuaire.duoLie('chris', invite.proprietaire)).toBe(true);
  });

  test('refus de l’aiguilleur rendus tels quels : nœud révoqué 409, limite atteinte 429', async () => {
    const m = ici();
    const tour = await noeudRattache(m);
    for (let i = 0; i < CODES_ACTIFS_MAX_PAR_PROPRIETAIRE; i++) await tour.codes.creer({ genre: 'meme_proprietaire' });
    const plein = await tour.codes.creer({ genre: 'meme_proprietaire' });
    expect(plein).toMatchObject({ ok: false, statut: 429 });
    m.annuaire.revoquer(tour.id);
    expect(await tour.codes.creer({ genre: 'meme_proprietaire' })).toMatchObject({ ok: false, statut: 409 });
  });

  test('aiguilleur injoignable : 502, et le code n’apparaît dans aucun journal', async () => {
    const m = ici();
    const tour = await noeudRattache(m);
    const r = await tour.codes.creer({ genre: 'meme_proprietaire' });
    expect(r.ok).toBe(true);
    m.serveur.stop(true);
    expect(await tour.codes.creer({ genre: 'meme_proprietaire' })).toMatchObject({ ok: false, statut: 502 });
    if (r.ok) expect(m.lignes.join('\n')).not.toContain(r.valeur.code);
  });
});

describe('route de l’appli : POST /api/federation/codes', () => {
  const protege = (g: (req: Request & { params: Record<string, string> }) => Response | Promise<Response>) => g;
  const requete = (corps: unknown): Request & { params: Record<string, string> } =>
    Object.assign(
      new Request('http://local/api/federation/codes', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(corps),
      }),
      { params: {} },
    );

  test('corps invalide : 400 ; corps valide : 200 avec le code et son échéance', async () => {
    const m = ici();
    const tour = await noeudRattache(m);
    const table = routesCodesReseau(tour.codes, protege);
    const handler = table['/api/federation/codes'].POST;
    expect((await handler(requete({ genre: 'invitation_duo' }))).status).toBe(400);
    expect((await handler(requete({ genre: 'meme_proprietaire', nomInvite: 'x' }))).status).toBe(400);
    const rep = await handler(requete({ genre: 'meme_proprietaire' }));
    expect(rep.status).toBe(200);
    expect(await rep.json()).toEqual({ code: expect.any(String), expireLe: expect.any(String) });
  });
});
