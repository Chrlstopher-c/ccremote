// Admissions propagées sur l'aiguilleur réel : un appareil admis une fois sur un nœud se relie aux autres nœuds
// de mêmes propriétaire sans appairage ; un appareil inconnu reste refusé ; une révocation vaut partout ; la
// propagation traverse un nœud intermédiaire ; la route des nœuds sert les clés aux appareils admis.
import { afterEach, beforeEach, expect, test } from 'bun:test';
import { exporterIdentitePublique, genererIdentite } from '../../commun/chiffrement/identite.ts';
import { routesFederation } from './api-federation.ts';
import { servirAppareil } from './appareils.ts';
import { type Appareil, appareilAvecCode, appairerAppareil, MAJ, PROPRIETAIRE, silencieux } from './banc-appareil.ts';
import { attendre, creerNoeud, monterAiguilleur, type Monte, type Noeud, relier } from './banc-federation.ts';
import type { TableInterne } from './executeur.ts';
import type { CanalNoeud } from './canal.ts';

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

/** Un nœud qui sert ses routes de fédération à ses appareils (même forme de table que le relais). */
async function nouveau(nom: string): Promise<{ noeud: Noeud; id: string }> {
  let table: TableInterne = {};
  const noeud = creerNoeud(nom, { servirAppareil: (d) => servirAppareil(table, silencieux)(d) });
  // Forme de table identique à bin.ts : les gestionnaires Bun.serve, servis sans protection supplémentaire.
  table = routesFederation(noeud.federation, (g) => g) as unknown as TableInterne;
  noeuds.push(noeud);
  const id = await relier(noeud, monte, PROPRIETAIRE);
  await attendre(async () => (await noeud.federation.etat()).aiguilleur?.relie === true);
  return { noeud, id };
}

/** Appairage complet entre nœuds : `a` demande, `b` accepte, le lien chiffré s'ouvre des deux côtés. */
async function appairerNoeuds(a: Noeud, idA: string, b: Noeud, idB: string): Promise<void> {
  await attendre(async () => (await a.federation.etat()).membres.some((m) => m.id === idB && m.enLigne));
  expect(a.federation.appairer(idB).ok).toBe(true);
  await attendre(async () => (await b.federation.etat()).demandes.length === 1);
  const demande = (await b.federation.etat()).demandes[0];
  expect(b.federation.decider(demande?.id ?? '', true).ok).toBe(true);
  await attendre(async () => (await a.federation.etat()).noeuds.some((n) => n.id === idB && n.liaisonOuverte));
  await attendre(async () => (await b.federation.etat()).noeuds.some((n) => n.id === idA && n.liaisonOuverte));
}

let canaux = 0;

/** Tente un lien de l'appareil vers `vers` : rend l'identifiant du canal s'il est ouvert, null s'il est refusé. */
async function tenterLien(appareil: Appareil, vers: string): Promise<string | null> {
  canaux += 1;
  const id = `lien-${canaux}`;
  const refusesAvant = appareil.refusees.length;
  appareil.ouvrir(id, vers, 'lien');
  await attendre(
    () => appareil.ouverts.includes(id) || appareil.fermes.includes(id) || appareil.refusees.length > refusesAvant,
    3000,
  );
  return appareil.ouverts.includes(id) ? id : null;
}

function canalOuvert(appareil: Appareil, id: string): CanalNoeud {
  const canal = appareil.canaux.get(id);
  if (!canal) throw new Error(`canal ${id} inconnu`);
  return canal;
}

/** L'appareil apprend les clés des nœuds par un canal déjà ouvert : il vérifie ensuite un nœud non appairé. */
async function apprendreNoeuds(appareil: Appareil, canal: CanalNoeud): Promise<void> {
  const reponse = await appareil.appeler(canal, '/api/appareils/noeuds');
  const noeuds = (JSON.parse(reponse.corps) as { noeuds: { id: string; nom: string; identite: string }[] }).noeuds;
  appareil.pairs = noeuds.map((n) => ({ ...n, creeLe: MAJ, genre: 'noeud' as const }));
}

/** Relance le lien jusqu’à son acceptation : la propagation de l’admission peut arriver après l’appairage. */
async function lienAdmis(appareil: Appareil, vers: string): Promise<CanalNoeud> {
  for (let essai = 1; essai <= 100; essai++) {
    const id = await tenterLien(appareil, vers);
    if (id) return canalOuvert(appareil, id);
    await new Promise((r) => setTimeout(r, 30));
  }
  throw new Error('appareil admis jamais reconnu');
}

/** Relance le lien jusqu’à son refus : une révocation n’est visible qu’une fois propagée. */
async function attendreRefus(appareil: Appareil, vers: string): Promise<void> {
  for (let essai = 1; essai <= 100; essai++) {
    if ((await tenterLien(appareil, vers)) === null) return;
    await new Promise((r) => setTimeout(r, 30));
  }
  throw new Error('révocation jamais propagée');
}

test('un appareil admis sur A se relie à B sans appairage, et B sert la liste des nœuds', async () => {
  const a = await nouveau('tour');
  const b = await nouveau('portable');
  await appairerNoeuds(a.noeud, a.id, b.noeud, b.id);
  const { appareil, canal: canalA } = await appairerAppareil(monte, a.noeud, a.id);
  await apprendreNoeuds(appareil, canalA);

  const canal = await lienAdmis(appareil, b.id);
  const reponse = await appareil.appeler(canal, '/api/appareils/noeuds');
  expect(reponse.statut).toBe(200);
  const noeudsB = (JSON.parse(reponse.corps) as { noeuds: { id: string; identite: string }[] }).noeuds;
  const cleA = (await a.noeud.federation.noeudsAppareil()).noeuds.find((n) => n.id === a.id)?.identite;
  expect(noeudsB.map((n) => n.id).sort()).toEqual([a.id, b.id].sort());
  expect(noeudsB.find((n) => n.id === a.id)?.identite).toBe(cleA);
});

test('un appareil jamais admis reste refusé par un nœud du même propriétaire', async () => {
  const a = await nouveau('tour');
  const b = await nouveau('portable');
  await appairerNoeuds(a.noeud, a.id, b.noeud, b.id);
  const intrus = await appareilAvecCode(monte);
  const identiteB = (await b.noeud.federation.noeudsAppareil()).noeuds[0]?.identite ?? '';
  intrus.pairs = [{ id: b.id, nom: 'portable', identite: identiteB, creeLe: MAJ, genre: 'noeud' }];
  const refusesAvant = intrus.refusees.length;
  intrus.ouvrir('lien-intrus', b.id, 'lien');
  await attendre(() => intrus.refusees.length > refusesAvant);
  expect(intrus.ouverts).not.toContain('lien-intrus');
});

test('révoquer un appareil sur A le retire partout : B le refuse après propagation', async () => {
  const a = await nouveau('tour');
  const b = await nouveau('portable');
  await appairerNoeuds(a.noeud, a.id, b.noeud, b.id);
  const { appareil, canal: canalA } = await appairerAppareil(monte, a.noeud, a.id);
  await apprendreNoeuds(appareil, canalA);
  await lienAdmis(appareil, b.id);

  expect((await a.noeud.federation.revoquer(appareil.membre)).ok).toBe(true);
  await attendreRefus(appareil, b.id);
  await attendre(() => appareil.fermes.includes('ap-1'));
});

test('la propagation traverse un nœud intermédiaire : admis sur A, l’appareil atteint C', async () => {
  const a = await nouveau('tour');
  const b = await nouveau('portable');
  const c = await nouveau('mac');
  await appairerNoeuds(a.noeud, a.id, b.noeud, b.id);
  await appairerNoeuds(c.noeud, c.id, b.noeud, b.id);
  const { appareil, canal: canalA } = await appairerAppareil(monte, a.noeud, a.id);
  await apprendreNoeuds(appareil, canalA);
  const canalB = await lienAdmis(appareil, b.id);
  await apprendreNoeuds(appareil, canalB);

  const canalC = await lienAdmis(appareil, c.id);
  expect(await appareil.appeler(canalC, '/api/appareils/noeuds')).toMatchObject({ statut: 200 });
});

test('un appareil qui connaît mal la clé d’un nœud ne peut pas ouvrir de lien avec lui', async () => {
  const a = await nouveau('tour');
  const { appareil } = await appairerAppareil(monte, a.noeud, a.id);
  const inconnue = exporterIdentitePublique((await genererIdentite()).publique);
  appareil.pairs = [{ id: a.id, nom: 'tour', identite: inconnue, creeLe: '2026-11-22T10:00:00.000Z', genre: 'noeud' }];
  const refusesAvant = appareil.refusees.length;
  appareil.ouvrir('lien-faux', a.id, 'lien');
  await attendre(() => appareil.refusees.length > refusesAvant);
  expect(appareil.ouverts).not.toContain('lien-faux');
});
