// Responsabilité : droits de la charte sur le banc à deux nœuds et un aiguilleur réel — reprise adoptée par le
// pair autonome, non-chef bloqué (édition, charte falsifiée sur le lien), écriture refusée après retrait de
// `piloter`, instantanés coupés sans `voir`, révocation d'un membre retiré, requête d'un ami du duo relayée (la
// machine visée applique les droits de l'ami sur elle-même).
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { regleDroitsAmi } from '../../commun/charte-amis.ts';
import { type Droits } from '../../commun/charte-droits.ts';
import { exporterIdentitePublique, genererIdentite } from '../../commun/chiffrement/identite.ts';
import {
  type Charte,
  changerMembre,
  creerCharte,
  nommerChef,
  retirerMembre,
  signerCharte,
  TOUS_DROITS,
} from '../../commun/charte.ts';
import type { MessageChiffre } from '../../commun/federation.ts';
import type { CanalNoeud } from './canal.ts';
import type { Canaux } from './canaux.ts';
import { attendre, creerNoeud, ficheDe, monterAiguilleur, type Monte, type Noeud, relier } from './banc-federation.ts';

const SESSION_A = 'session-a';
const SESSION_A2 = 'session-a2';

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

async function nouveau(nom: string, options = {}): Promise<Noeud> {
  const n = creerNoeud(nom, options);
  noeuds.push(n);
  await relier(n, monte, 'alice');
  return n;
}

async function idDe(n: Noeud): Promise<string> {
  const id = (await n.federation.etat()).aiguilleur?.id;
  if (!id) throw new Error('nœud non relié');
  return id;
}

async function enLignePour(vu: Noeud, cible: string): Promise<void> {
  await attendre(async () => (await vu.federation.etat()).membres.some((m) => m.id === cible && m.enLigne));
}

/** Appairage complet : A demande, B accepte, le lien chiffré s'ouvre des deux côtés. */
async function appairer(a: Noeud, b: Noeud): Promise<{ idA: string; idB: string }> {
  const idA = await idDe(a);
  const idB = await idDe(b);
  await enLignePour(a, idB);
  expect(a.federation.appairer(idB).ok).toBe(true);
  await attendre(async () => (await b.federation.etat()).demandes.length === 1);
  const demande = (await b.federation.etat()).demandes[0];
  expect(b.federation.decider(demande?.id ?? '', true).ok).toBe(true);
  await attendre(async () => (await a.federation.etat()).noeuds.some((n) => n.id === idB && n.liaisonOuverte));
  await attendre(async () => (await b.federation.etat()).noeuds.some((n) => n.id === idA && n.liaisonOuverte));
  return { idA, idB };
}

function poser(n: Noeud, id: string): void {
  const fiche = ficheDe(id, 'portable', `Titre ${id}`);
  n.registre.enregistrerSession(fiche);
  n.diffusion.diffuser({ type: 'session', session: fiche });
}

/** Le lien chiffré de `de` vers `vers`, pour y déposer un message forgé (accès d'essai, seul moyen). */
function lienOuvert(de: Noeud, vers: string): CanalNoeud | null {
  const interne = de.federation as unknown as { canaux: Canaux };
  return interne.canaux.liaisonOuverteAvec(vers);
}

function pause(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

describe('reprise et adoption', () => {
  test('le nœud embarqué crée le réseau du parc ; le pair autonome l’adopte au premier lien', async () => {
    const a = await nouveau('portable', { peutReprendre: true });
    const b = await nouveau('tour');
    const { idA, idB } = await appairer(a, b);
    await attendre(() => b.federation.charte.charte() !== null);
    expect(b.federation.charte.charte()?.origine).toBe('reprise');
    expect(b.federation.estChef(idA)).toBe(true);
    expect(b.federation.estChef(idB)).toBe(false);
    expect(a.federation.charte.charte()?.reseau).toBe(b.federation.charte.charte()?.reseau);
  });
});

describe('non-chef bloqué', () => {
  test('édition refusée (403) ; charte falsifiée sur le lien réel refusée, charte inchangée', async () => {
    const a = await nouveau('portable', { peutReprendre: true });
    const b = await nouveau('tour');
    const { idA, idB } = await appairer(a, b);
    await attendre(() => b.federation.charte.charte() !== null);
    const r = await b.federation.charte.editer((c, moi, le) => nommerChef(c, moi, idB, true, le));
    expect(r.ok).toBe(false);
    expect(r.ok ? 0 : r.statut).toBe(403);
    const base = b.federation.charte.charte();
    if (base === null) throw new Error('charte absente');
    const intrus = await genererIdentite();
    const moi = { id: idB, nom: 'b', identite: exporterIdentitePublique(intrus.publique) };
    const forgee = { ...creerCharte({ reseau: base.reseau, nom: 'x', moi, le: 'x' }), version: base.version + 1 };
    const signee = await signerCharte(forgee, intrus.signaturePrivee);
    const canal = lienOuvert(b, idA);
    expect(canal).not.toBeNull();
    const message: MessageChiffre = { t: 'charte', texte: signee.texte, signature: signee.signature };
    canal?.envoyer(message);
    await pause(200);
    expect(a.federation.charte.charte()?.version).toBe(base.version);
    expect(a.federation.estChef(idB)).toBe(false);
  });
});

describe('droits appliqués entre nœuds', () => {
  test('piloter retiré : écrire refusé chez le nœud qui tient la session, le fil reste lisible', async () => {
    const a = await nouveau('portable', { peutReprendre: true });
    const b = await nouveau('tour');
    const { idA, idB } = await appairer(a, b);
    await attendre(() => b.federation.charte.charte() !== null);
    poser(a, SESSION_A);
    await attendre(() => b.federation.distantes.sessions().some((s) => s.session.id === SESSION_A));
    const droits = { ...TOUS_DROITS, piloter: false };
    const r = await a.federation.charte.editer((c, moi, le) => changerMembre(c, moi, idB, { droits }, le));
    expect(r.ok).toBe(true);
    await attendre(() => b.federation.charte.charte()?.membres.find((m) => m.id === idB)?.droits.piloter === false);
    expect((await b.federation.distantes.ecrire(idA, SESSION_A, 'refusé')).ok).toBe(false);
    expect(a.appels.ecrire).toEqual([]);
    expect((await b.federation.distantes.fil(idA, SESSION_A)).ok).toBe(true);
  });

  test('voir retiré : le pair ne reçoit plus les sessions nouvelles', async () => {
    const a = await nouveau('portable', { peutReprendre: true });
    const b = await nouveau('tour');
    const { idA, idB } = await appairer(a, b);
    await attendre(() => b.federation.charte.charte() !== null);
    poser(a, SESSION_A);
    await attendre(() => b.federation.distantes.sessions().some((s) => s.session.id === SESSION_A));
    const droits = { ...TOUS_DROITS, voir: false };
    const modifie = (c: Charte, moi: string, le: string) => changerMembre(c, moi, idB, { droits }, le);
    expect((await a.federation.charte.editer(modifie)).ok).toBe(true);
    poser(a, SESSION_A2);
    await pause(700);
    expect(b.federation.distantes.sessions().some((s) => s.session.id === SESSION_A2)).toBe(false);
  });

  test('membre retiré de la charte : révoqué des deux côtés, plus de nœud', async () => {
    const a = await nouveau('portable', { peutReprendre: true });
    const b = await nouveau('tour');
    const { idB } = await appairer(a, b);
    await attendre(() => b.federation.charte.charte() !== null);
    expect((await a.federation.charte.editer((c, moi, le) => retirerMembre(c, moi, idB, le))).ok).toBe(true);
    await attendre(async () => (await a.federation.etat()).noeuds.length === 0);
    await attendre(async () => (await b.federation.etat()).noeuds.length === 0);
  });
});

describe('requête d un ami du duo relayée vers cette machine', () => {
  const AMI = 'eeeeeeeeeeee';
  const VOIR = { voir: true, piloter: false, lancer: false, remoteControl: false };
  const PILOTER = { voir: true, piloter: true, lancer: false, remoteControl: false };

  /** Machine A tient la session, B la relaie ; la charte de A donne à l'ami `droits` sur A. */
  async function parcAvecAmi(droits: Droits): Promise<{ a: Noeud; b: Noeud; idA: string }> {
    const a = await nouveau('portable', { peutReprendre: true });
    const b = await nouveau('tour');
    const { idA } = await appairer(a, b);
    await attendre(() => b.federation.charte.charte() !== null);
    poser(a, SESSION_A);
    await attendre(() => b.federation.distantes.sessions().some((s) => s.session.id === SESSION_A));
    const r = await a.federation.charte.editer((c, moi, le) => regleDroitsAmi(c, moi, AMI, idA, droits, le));
    expect(r.ok).toBe(true);
    return { a, b, idA };
  }

  test('hors des droits de l ami sur la machine visée : refusée là-bas, rien n arrive à la session', async () => {
    const { a, b, idA } = await parcAvecAmi(VOIR);
    const r = await b.federation.distantes.ecrire(idA, SESSION_A, 'hors droits', AMI);
    expect(r.ok).toBe(false);
    expect(a.appels.ecrire).toEqual([]);
  });

  test('dans les droits de l ami sur la machine visée : servie', async () => {
    const { a, b, idA } = await parcAvecAmi(PILOTER);
    const r = await b.federation.distantes.ecrire(idA, SESSION_A, 'dans les droits', AMI);
    expect(r.ok).toBe(true);
    expect(a.appels.ecrire).toEqual([[SESSION_A, 'dans les droits']]);
  });

  test('sans étiquette d ami : comportement inchangé, la règle du pair seule', async () => {
    const { a, b, idA } = await parcAvecAmi(VOIR);
    const r = await b.federation.distantes.ecrire(idA, SESSION_A, 'sans ami');
    expect(r.ok).toBe(true);
    expect(a.appels.ecrire).toEqual([[SESSION_A, 'sans ami']]);
  });

  test('identifiant qui n est pas celui de la charte (ex. principal) : non relayée, refus local', async () => {
    const { a, b, idA } = await parcAvecAmi(PILOTER);
    const r = await b.federation.distantes.ecrire(idA, SESSION_A, 'principal', 'principal');
    expect(r.ok).toBe(false);
    expect(r.ok ? 0 : r.statut).toBe(403);
    expect(a.appels.ecrire).toEqual([]);
  });
});
