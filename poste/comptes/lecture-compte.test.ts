import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import pino from 'pino';
import { DetailCompte, type UsageSdk } from '../../commun/compte-detail.ts';
import { AGENT_CLI, LecteurCompte } from './lecture-compte.ts';

// Faux serveur d'Anthropic (Bun.serve sur un port libre) : aucune requête réseau réelle.
const ORG = '00000000-0000-4000-8000-000000000002';
const JETON = 'jeton-factice-0123456789';
const CHEMIN_RESET = `/api/organizations/${ORG}/reset_rate_limits`;
const CHEMIN_PREPAYE = `/api/oauth/organizations/${ORG}/prepaid/credits`;
const CHEMIN_CEDAR = '/api/oauth/usage?cedar_ember=1&skip_spend=1';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SDK_NUL = async (): Promise<UsageSdk | null> => null;

const lire = (nom: string): unknown => JSON.parse(readFileSync(new URL(`./fixtures/${nom}`, import.meta.url), 'utf8'));
// L'usage est relevé par le relais : le détail reçoit la dernière valeur bonne, il ne l'interroge pas.
const FOURNI = { usage: lire('usage.json'), cedar: lire('usage_cedar.json') };

interface Recue {
  readonly methode: string;
  readonly chemin: string;
  readonly entetes: Headers;
  readonly corps: string;
}

let serveur: ReturnType<typeof Bun.serve>;
let recues: Recue[];
let statuts: Map<string, number>;
let statutReset: number;
let corpsReset: unknown;
let lignes: string[];
let t: number;

function reponseJson(corps: unknown, statut = 200): Response {
  return Response.json(corps, { status: statut });
}

function reponseFaux(chemin: string): Response {
  const statut = statuts.get(chemin);
  if (statut !== undefined) return reponseJson({ erreur: 'simulée' }, statut);
  if (chemin === '/api/oauth/profile') return reponseJson(lire('profile.json'));
  if (chemin === '/api/oauth/usage') return reponseJson(lire('usage.json'));
  if (chemin === CHEMIN_CEDAR) return reponseJson(lire('usage_cedar.json'));
  if (chemin === CHEMIN_PREPAYE) return reponseJson(lire('prepaid.json'));
  return reponseJson({ erreur: 'chemin inconnu du faux serveur' }, 404);
}

function reponseReset(): Response {
  return reponseJson(corpsReset, statutReset);
}

beforeEach(() => {
  recues = [];
  statuts = new Map();
  statutReset = 200;
  corpsReset = {
    result: 'reset',
    reason: null,
    resets_left: 0,
    cleared: ['five_hour', 'seven_day'],
    weekly_resets_at: '2026-11-22T19:00:00Z',
    cooldown_until: null,
  };
  lignes = [];
  t = 1_000_000;
  serveur = Bun.serve({
    port: 0,
    fetch: async (req: Request): Promise<Response> => {
      const url = new URL(req.url);
      const chemin = url.pathname + url.search;
      const corps = req.method === 'POST' ? await req.text() : '';
      recues.push({ methode: req.method, chemin, entetes: req.headers, corps });
      return req.method === 'POST' && url.pathname === CHEMIN_RESET ? reponseReset() : reponseFaux(chemin);
    },
  });
});

afterEach(() => {
  serveur.stop(true);
});

function lecteur(jeton: (dossier: string | null) => string | null = () => JETON): LecteurCompte {
  const journal = pino({ level: 'trace' }, { write: (l: string) => lignes.push(l) });
  return new LecteurCompte({ api: `http://127.0.0.1:${serveur.port}`, journal, maintenant: () => t, jeton });
}

const compteur = (chemin: string): number => recues.filter((r) => r.chemin === chemin).length;

describe('lecture du détail d’un compte', () => {
  test('deux lectures réseau (profil, crédits) avec les bons en-têtes ; l’usage vient du relais ; contrat passé', async () => {
    const d = await lecteur().detail('principal', null, 'tour', SDK_NUL, FOURNI);
    expect(() => DetailCompte.parse(d)).not.toThrow();
    expect(d.profil?.nom).toBe('Chris');
    expect(d.creditsPrepayes?.solde?.mineur).toBe(54);
    expect(d.probleme).toBeNull();
    const chemins = recues.map((r) => r.chemin).sort();
    expect(chemins).toEqual(['/api/oauth/profile', CHEMIN_PREPAYE].sort());
    const entetes = recues[0]?.entetes;
    expect(entetes?.get('authorization')).toBe(`Bearer ${JETON}`);
    expect(entetes?.get('anthropic-beta')).toBe('oauth-2025-04-20');
    expect(entetes?.get('anthropic-version')).toBe('2023-06-01');
  });

  test('chaque requête se présente comme le CLI (le serveur en déduit la surface)', async () => {
    await lecteur().detail('principal', null, 'tour', SDK_NUL, FOURNI);
    await lecteur().reinitialiser('principal', null, 'full-reset-2611');
    expect(recues.length).toBeGreaterThan(3);
    for (const r of recues) expect(r.entetes.get('user-agent')).toBe(AGENT_CLI);
  });

  test('ni le jeton ni l’uuid d’organisation ne sortent dans le résultat', async () => {
    const d = await lecteur().detail('principal', null, 'tour', SDK_NUL, FOURNI);
    const texte = JSON.stringify(d);
    expect(texte).not.toContain(JETON);
    expect(texte).not.toContain(ORG);
  });

  test('cache de 60 s par compte : un seul relevé des crédits dans la minute ; le profil est gardé 10 min', async () => {
    const l = lecteur();
    await l.detail('principal', null, 'tour', SDK_NUL, FOURNI);
    t += 59_000;
    await l.detail('principal', null, 'tour', SDK_NUL, FOURNI);
    expect(compteur(CHEMIN_PREPAYE)).toBe(1);
    t += 2_000;
    await l.detail('principal', null, 'tour', SDK_NUL, FOURNI);
    expect(compteur(CHEMIN_PREPAYE)).toBe(2);
    expect(compteur('/api/oauth/profile')).toBe(1);
  });

  test('deux appels concurrents partagent une seule série de requêtes', async () => {
    const l = lecteur();
    const [a, b] = await Promise.all([
      l.detail('principal', null, 'tour', SDK_NUL),
      l.detail('principal', null, 'tour', SDK_NUL),
    ]);
    expect(a).toEqual(b);
    expect(compteur(CHEMIN_PREPAYE)).toBe(1);
  });

  test('le relais n’a encore rien relevé : la partie usage reste vide, la phrase le dit, le reste est lu', async () => {
    const d = await lecteur().detail('principal', null, 'tour', SDK_NUL, null);
    expect(d.fenetres).toEqual([]);
    expect(d.probleme).toContain('relevée par le relais');
    expect(d.creditsPrepayes?.solde?.mineur).toBe(54);
    expect(compteur('/api/oauth/usage')).toBe(0);
  });

  test('profil en échec : pas de lecture des crédits prépayés (il faut l’organisation)', async () => {
    statuts.set('/api/oauth/profile', 401);
    const d = await lecteur().detail('principal', null, 'tour', SDK_NUL, FOURNI);
    expect(d.profil).toBeNull();
    expect(d.creditsPrepayes).toBeNull();
    expect(compteur(CHEMIN_PREPAYE)).toBe(0);
    expect(d.probleme).toContain('profil');
  });

  test('pas de jeton utilisable : aucune requête, un problème dit pourquoi', async () => {
    const d = await lecteur(() => null).detail('principal', null, 'tour', SDK_NUL, null);
    expect(recues).toHaveLength(0);
    expect(d.probleme).toContain('jeton');
    expect(d.fenetres).toEqual([]);
  });

  test('un jeton illisible (exception) se traite comme absent', async () => {
    const d = await lecteur(() => {
      throw new Error('fichier corrompu');
    }).detail('principal', null, 'tour', SDK_NUL, FOURNI);
    expect(recues).toHaveLength(0);
    expect(d.probleme).toContain('jeton');
  });

  test('le SDK qui échoue ne casse pas la vue : sdk à null', async () => {
    const d = await lecteur().detail('principal', null, 'tour', async () => {
      throw new Error('session cassée');
    });
    expect(d.sdk).toBeNull();
    expect(d.profil?.nom).toBe('Chris');
  });

  test('le journal ne contient ni le jeton ni l’uuid, même quand une lecture échoue', async () => {
    statuts.set('/api/oauth/profile', 401);
    await lecteur().detail('principal', null, 'tour', SDK_NUL, FOURNI);
    const journal = lignes.join('\n');
    expect(journal).toContain('principal');
    expect(journal).not.toContain(JETON);
    expect(journal).not.toContain(ORG);
  });
});

describe('réinitialisation d’une limite', () => {
  test('POST sur le chemin de l’organisation, corps exact, identifiant de demande aléatoire', async () => {
    const r = await lecteur().reinitialiser('principal', null, 'full-reset-2611');
    const post = recues.find((x) => x.methode === 'POST');
    expect(post?.chemin).toBe(CHEMIN_RESET);
    expect(post?.entetes.get('content-type')).toBe('application/json');
    const corps = JSON.parse(post?.corps ?? '{}') as Record<string, unknown>;
    expect(Object.keys(corps).sort()).toEqual(['grant_id', 'program', 'request_id']);
    expect(corps['program']).toBe('cedar_ember');
    expect(corps['grant_id']).toBe('full-reset-2611');
    expect(String(corps['request_id'])).toMatch(UUID);
    expect(r).toMatchObject({ resultat: 'reset', efface: ['five_hour', 'seven_day'], restantes: 0 });
  });

  test('après une réinitialisation, le détail est relu (cache du compte invalidé)', async () => {
    const l = lecteur();
    await l.detail('principal', null, 'tour', SDK_NUL, FOURNI);
    await l.reinitialiser('principal', null, 'full-reset-2611');
    await l.detail('principal', null, 'tour', SDK_NUL, FOURNI);
    expect(compteur(CHEMIN_PREPAYE)).toBe(2);
  });

  test('429 : rate_limited ; 401 : auth_error ; autre échec : error', async () => {
    const l = lecteur();
    statutReset = 429;
    expect((await l.reinitialiser('principal', null, 'full-reset-2611')).resultat).toBe('rate_limited');
    statutReset = 401;
    expect((await l.reinitialiser('principal', null, 'full-reset-2611')).resultat).toBe('auth_error');
    statutReset = 500;
    expect((await l.reinitialiser('principal', null, 'full-reset-2611')).resultat).toBe('error');
  });

  test('succès sans résultat lisible : error', async () => {
    corpsReset = { autre: true };
    const r = await lecteur().reinitialiser('principal', null, 'full-reset-2611');
    expect(r.resultat).toBe('error');
    expect(r.raison).toBe('réponse illisible');
  });

  test('identifiant d’offre invalide : rien n’est envoyé', async () => {
    const r = await lecteur().reinitialiser('principal', null, '../autre');
    expect(r.resultat).toBe('error');
    expect(recues.filter((x) => x.methode === 'POST')).toHaveLength(0);
  });

  test('sans jeton : auth_error, aucune requête', async () => {
    const r = await lecteur(() => null).reinitialiser('principal', null, 'full-reset-2611');
    expect(r.resultat).toBe('auth_error');
    expect(recues).toHaveLength(0);
  });
});
