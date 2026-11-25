// Responsabilité : l'historique d'une session d'un pair reste servi quand ce pair est hors ligne (en-tête
// X-Lanterne-Hors-Ligne) ; sans historique gardé, la réponse d'erreur d'origine. Aiguilleur réel, données de test.
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { GesteLocal } from './echanges.ts';
import {
  attendre,
  creerNoeud,
  ficheDe,
  MAJ,
  monterAiguilleur,
  type Monte,
  type Noeud,
  relier,
} from './banc-federation.ts';

const SESSION = 'session-a';
const AUTRE = 'session-b';
const FIL = [{ id: 1, session: SESSION, t: MAJ, evt: { type: 'message', texte: 'historique de A' } }];
const url = (session: string, requete = ''): Request =>
  new Request(`http://local/api/sessions/${session}/evenements${requete}`);

let monte: Monte;
let noeuds: Noeud[] = [];

beforeEach(() => {
  monte = monterAiguilleur();
  noeuds = [];
});

afterEach(() => {
  for (const n of noeuds) n.federation.arreter();
  monte.serveur.stop(true);
});

/** Le pair (tour) sert son fil pour `evenements`, rien d'autre de particulier. */
const gestesTour = (g: GesteLocal): Response | undefined =>
  g.geste === 'evenements' ? Response.json(FIL) : undefined;

async function nouveau(nom: string, gestes?: (g: GesteLocal) => Response | undefined): Promise<Noeud> {
  const n = creerNoeud(nom, {}, gestes);
  noeuds.push(n);
  await relier(n, monte, 'alice');
  return n;
}

async function appairer(a: Noeud, b: Noeud): Promise<string> {
  const idA = (await a.federation.etat()).aiguilleur?.id ?? '';
  const idB = (await b.federation.etat()).aiguilleur?.id ?? '';
  await attendre(async () => (await a.federation.etat()).membres.some((m) => m.id === idB && m.enLigne));
  expect(a.federation.appairer(idB).ok).toBe(true);
  await attendre(async () => (await b.federation.etat()).demandes.length === 1);
  const demande = (await b.federation.etat()).demandes[0];
  expect(b.federation.decider(demande?.id ?? '', true).ok).toBe(true);
  await attendre(async () => (await b.federation.etat()).noeuds.some((n) => n.id === idA && n.liaisonOuverte));
  return idA;
}

function poser(n: Noeud, session: string): void {
  n.registre.enregistrerSession(ficheDe(session, 'tour', session));
  n.diffusion.diffuser({ type: 'session', session: ficheDe(session, 'tour', session) });
}

/** Tour en ligne et appariée, deux sessions connues ; le portable a lu l'historique de la première. */
async function scenario(): Promise<{ tour: Noeud; portable: Noeud; idTour: string }> {
  const tour = await nouveau('tour', gestesTour);
  const portable = await nouveau('portable');
  const idTour = await appairer(tour, portable);
  poser(tour, SESSION);
  poser(tour, AUTRE);
  await attendre(() => portable.federation.distantes.sessions().length === 2);
  return { tour, portable, idTour };
}

async function horsLigne(tour: Noeud, portable: Noeud): Promise<void> {
  tour.federation.arreter();
  await attendre(() => portable.federation.distantes.sessions().every((s) => s.enLigne === false));
}

describe('historique d’une session d’un pair gardé pour le hors-ligne', () => {
  test('pair en ligne : le fil est servi comme avant, sans en-tête hors ligne', async () => {
    const { portable } = await scenario();
    const r = await portable.federation.distantes.intercepter(url(SESSION));
    expect(r?.status).toBe(200);
    expect(r?.headers.get('x-lanterne-hors-ligne')).toBeNull();
    expect(await r?.text()).toBe(JSON.stringify(FIL));
  });

  test('pair hors ligne avec historique gardé : 200 avec le corps gardé et l’en-tête', async () => {
    const { tour, portable } = await scenario();
    await portable.federation.distantes.intercepter(url(SESSION));
    await horsLigne(tour, portable);
    const r = await portable.federation.distantes.intercepter(url(SESSION));
    expect(r?.status).toBe(200);
    expect(r?.headers.get('x-lanterne-hors-ligne')).toBe('1');
    expect(await r?.json()).toEqual(FIL);
  });

  test('pair hors ligne sans historique pour cette session : erreur d’origine, inchangée', async () => {
    const { tour, portable } = await scenario();
    await portable.federation.distantes.intercepter(url(SESSION));
    await horsLigne(tour, portable);
    const r = await portable.federation.distantes.intercepter(url(AUTRE));
    expect(r?.status).toBe(409);
    expect(r?.headers.get('x-lanterne-hors-ligne')).toBeNull();
    expect(await r?.json()).toEqual({ erreur: 'machine hors ligne : la session est sur un autre nœud du réseau' });
  });

  test('requête paginée (curseur) : jamais servie depuis l’historique gardé', async () => {
    const { tour, portable } = await scenario();
    await portable.federation.distantes.intercepter(url(SESSION));
    await horsLigne(tour, portable);
    const r = await portable.federation.distantes.intercepter(url(SESSION, '?apres=3'));
    expect(r?.status).toBe(409);
    expect(r?.headers.get('x-lanterne-hors-ligne')).toBeNull();
  });
});
