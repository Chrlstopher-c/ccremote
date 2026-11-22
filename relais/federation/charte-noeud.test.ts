// Responsabilité : tests unitaires de la charte côté nœud — genèse, succession, refus, révocation, reprise, admission.
// Port factice (identité, pairs, liens relevés), secrets réels dans un dossier temporaire.
import { describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pino from 'pino';
import {
  ajouterMembre,
  changerMembre,
  creerCharte,
  type CharteSignee,
  type MembreCharte,
  retirerMembre,
  signerCharte,
  type Sorte,
  TOUS_DROITS,
} from '../../commun/charte.ts';
import { exporterIdentitePublique, genererIdentite, type Identite } from '../../commun/chiffrement/identite.ts';
import type { MessageChiffre } from '../../commun/federation.ts';
import type { PresentationDistante } from './canal.ts';
import { CharteNoeud, type LienCharte, type PortCharte } from './charte-noeud.ts';
import { type PairFederee, SecretsNoeud } from './secrets.ts';

const journal = pino({ enabled: false });
const A = 'aaaaaaaaaaaa';
const B = 'bbbbbbbbbbbb';
const C = 'cccccccccccc';
const D = 'dddddddddddd';

interface Noeud {
  readonly id: string;
  readonly pub: string;
  readonly identite: Identite;
  readonly secrets: SecretsNoeud;
  readonly port: PortCharte;
  readonly charte: CharteNoeud;
  readonly pairs: PairFederee[];
  readonly liens: LienCharte[];
  readonly revoques: string[];
}

async function noeud(id: string, peutReprendre = false): Promise<Noeud> {
  const secrets = new SecretsNoeud(mkdtempSync(join(tmpdir(), `charte-${id}-`)), journal);
  const identite = await genererIdentite();
  const pairs: PairFederee[] = [];
  const liens: LienCharte[] = [];
  const revoques: string[] = [];
  const port: PortCharte = {
    journal,
    secrets,
    peutReprendre,
    moi: () => id,
    nomLocal: () => `nom-${id}`,
    identite: async () => identite,
    pairs: () => pairs,
    liensNoeuds: () => liens,
    revoquer: (membre) => {
      revoques.push(membre);
      const i = pairs.findIndex((p) => p.id === membre);
      if (i >= 0) pairs.splice(i, 1);
    },
    signaler: () => undefined,
  };
  const pub = exporterIdentitePublique(identite.publique);
  return { id, pub, identite, secrets, port, charte: new CharteNoeud(port), pairs, liens, revoques };
}

function comme(n: Noeud, sorte: Sorte = 'serveur'): MembreCharte {
  return { id: n.id, nom: `nom-${n.id}`, sorte, identite: n.pub, droits: { ...TOUS_DROITS }, compte: null };
}

function pairDe(n: Noeud, genre: 'noeud' | 'appareil' = 'noeud'): PairFederee {
  return { id: n.id, nom: `nom-${n.id}`, identite: n.pub, creeLe: '2026-11-22T00:00:00.000Z', genre };
}

function lien(membre: string, sortie: MessageChiffre[]): LienCharte {
  return {
    membre,
    envoyer: (m) => {
      sortie.push(m);
      return true;
    },
  };
}

function presentation(n: Noeud): PresentationDistante {
  return { identite: n.pub, nom: `nom-${n.id}`, genre: 'noeud' };
}

function signeeDe(n: Noeud): CharteSignee {
  const lue = n.secrets.lireCharte();
  if (lue === null) throw new Error('charte absente chez le nœud');
  return lue;
}

function reseauDe(n: Noeud): string | null {
  return n.charte.charte()?.reseau ?? null;
}

/** Trois nœuds : A chef (version 3 avec B et C), B et C l'ont adoptée. */
async function reseau(): Promise<{ a: Noeud; b: Noeud; c: Noeud }> {
  const a = await noeud(A);
  const b = await noeud(B);
  const c = await noeud(C);
  expect((await a.charte.creer('Maison')).ok).toBe(true);
  expect((await a.charte.editer((ch, moi, le) => ajouterMembre(ch, moi, comme(b), le))).ok).toBe(true);
  expect((await a.charte.editer((ch, moi, le) => ajouterMembre(ch, moi, comme(c), le))).ok).toBe(true);
  await b.charte.recevoir(A, signeeDe(a), 'accepte');
  await c.charte.recevoir(A, signeeDe(a), 'accepte');
  return { a, b, c };
}

describe('adoption et succession', () => {
  test('genèse : un nœud sans charte adopte celle d’un chef qui le compte', async () => {
    const { b } = await reseau();
    expect(b.charte.charte()?.version).toBe(3);
    expect(b.charte.charte()?.chefs).toEqual([A]);
  });

  test('succession : la version suivante d’un chef est adoptée, une version ancienne ne revient pas', async () => {
    const { a, b } = await reseau();
    const v3 = signeeDe(a);
    const sans = { ...TOUS_DROITS, voir: false };
    const r = await a.charte.editer((ch, moi, le) => changerMembre(ch, moi, B, { droits: sans }, le));
    expect(r.ok).toBe(true);
    await b.charte.recevoir(A, signeeDe(a), 'accepte');
    expect(b.charte.charte()?.version).toBe(4);
    expect(b.charte.autorise(B, { genre: 'fil' })).toBe(false);
    expect(b.charte.autorise(B, { genre: 'ecrire' })).toBe(true);
    await b.charte.recevoir(A, v3, 'accepte');
    expect(b.charte.charte()?.version).toBe(4);
  });

  test('refus : une charte signée par un non-chef ne change rien', async () => {
    const { b, c } = await reseau();
    const base = b.charte.charte();
    if (base === null) throw new Error('charte absente');
    const moi = { id: C, nom: 'c', identite: c.pub };
    const faux = { ...creerCharte({ reseau: base.reseau, nom: 'x', moi, le: 'x' }), version: 9 };
    await b.charte.recevoir(C, await signerCharte(faux, c.identite.signaturePrivee), 'accepte');
    expect(b.charte.charte()?.version).toBe(3);
  });

  test('refus : une charte reçue d’un pair non apparié ou d’un appareil est ignorée', async () => {
    const { a, b } = await reseau();
    const v3 = signeeDe(a);
    await b.charte.recevoir(A, v3, 'non-appaire');
    await b.charte.recevoir(A, v3, 'autre-proprietaire');
    expect(b.charte.charte()?.version).toBe(3);
  });

  test('démarrage : une charte locale falsifiée est ignorée, une valide est relue', async () => {
    const { b } = await reseau();
    const sain = signeeDe(b);
    b.secrets.ecrireCharte({ texte: sain.texte.replace('"nom":"Maison"', '"nom":"Autre"'), signature: sain.signature });
    const falsifiee = new CharteNoeud(b.port);
    await falsifiee.demarrer();
    expect(falsifiee.charte()).toBeNull();
    b.secrets.ecrireCharte(sain);
    const relue = new CharteNoeud(b.port);
    await relue.demarrer();
    expect(relue.charte()?.version).toBe(3);
  });
});

describe('édition par un chef seulement', () => {
  test('un non-chef ne peut pas éditer : 403, rien ne change', async () => {
    const { b } = await reseau();
    const d = await noeud(D);
    const r = await b.charte.editer((ch, moi, le) => ajouterMembre(ch, moi, comme(d), le));
    expect(r.ok).toBe(false);
    expect(!r.ok && r.statut).toBe(403);
    expect(b.charte.charte()?.version).toBe(3);
  });

  test('un chef édite : version suivante signée, relayée aux liens nœuds', async () => {
    const { a, b } = await reseau();
    const sortie: MessageChiffre[] = [];
    a.liens.push(lien(B, sortie));
    const r = await a.charte.editer((ch, moi, le) => changerMembre(ch, moi, B, { compte: 'pro' }, le));
    expect(r.ok).toBe(true);
    expect(a.charte.charte()?.version).toBe(4);
    expect(sortie.map((m) => m.t)).toEqual(['charte']);
    const relayee = sortie[0];
    if (relayee?.t !== 'charte') throw new Error('message attendu');
    await b.charte.recevoir(A, { texte: relayee.texte, signature: relayee.signature }, 'accepte');
    expect(b.charte.charte()?.membres.find((m) => m.id === B)?.compte).toBe('pro');
  });

  test('compte choisi : celui du nœud dans la charte', async () => {
    const { a } = await reseau();
    await a.charte.editer((ch, moi, le) => changerMembre(ch, moi, A, { compte: 'perso' }, le));
    expect(a.charte.compteDeMoi()).toBe('perso');
  });
});

describe('révocation des membres retirés', () => {
  test('un chef retire B : B est révoqué chez A, et chez C qui adopte la charte', async () => {
    const { a, b, c } = await reseau();
    a.pairs.push(pairDe(b), pairDe(c));
    c.pairs.push(pairDe(a), pairDe(b));
    const sortie: MessageChiffre[] = [];
    a.liens.push(lien(B, sortie), lien(C, sortie));
    expect((await a.charte.editer((ch, moi, le) => retirerMembre(ch, moi, B, le))).ok).toBe(true);
    expect(a.revoques).toEqual([B]);
    const relayee = sortie.find((m) => m.t === 'charte');
    if (relayee?.t !== 'charte') throw new Error('charte non relayée');
    await c.charte.recevoir(A, { texte: relayee.texte, signature: relayee.signature }, 'accepte');
    expect(c.revoques).toEqual([B]);
    expect(c.charte.autorise(B, { genre: 'ecrire' })).toBe(false);
  });
});

describe('reprise du parc', () => {
  test('nœud embarqué relié à un pair : réseau créé, chef lui-même, pairs serveur, appareils téléphone', async () => {
    const a = await noeud(A, true);
    const b = await noeud(B);
    const d = await noeud(D);
    a.pairs.push(pairDe(b), pairDe(d, 'appareil'));
    await a.charte.essayerReprise();
    const ch = a.charte.charte();
    expect(ch?.origine).toBe('reprise');
    expect(ch?.chefs).toEqual([A]);
    expect(ch?.membres.find((m) => m.id === B)?.sorte).toBe('serveur');
    expect(ch?.membres.find((m) => m.id === D)?.sorte).toBe('telephone');
  });

  test('ni reprise sans l’option embarquée, ni sans pair de genre nœud', async () => {
    const autonome = await noeud(A, false);
    autonome.pairs.push(pairDe(await noeud(B)));
    await autonome.charte.essayerReprise();
    expect(autonome.charte.charte()).toBeNull();
    const seul = await noeud(C, true);
    seul.pairs.push(pairDe(await noeud(D), 'appareil'));
    await seul.charte.essayerReprise();
    expect(seul.charte.charte()).toBeNull();
  });

  test('deux reprises concurrentes : la plus petite identité de réseau l’emporte chez les deux', async () => {
    const a = await noeud(A, true);
    const b = await noeud(B, true);
    a.pairs.push(pairDe(b));
    b.pairs.push(pairDe(a));
    await a.charte.essayerReprise();
    await b.charte.essayerReprise();
    const ra = reseauDe(a);
    const rb = reseauDe(b);
    if (ra === null || rb === null) throw new Error('reprise absente');
    await a.charte.recevoir(B, signeeDe(b), 'accepte');
    await b.charte.recevoir(A, signeeDe(a), 'accepte');
    const attendu = ra < rb ? ra : rb;
    expect(reseauDe(a)).toBe(attendu);
    expect(reseauDe(b)).toBe(attendu);
  });
});

describe('admissions, appairage et droits', () => {
  test('admissions : seuls les appareils membres de la charte, avec la même identité', async () => {
    const { a, c } = await reseau();
    const d = await noeud(D);
    const liste = [
      { id: C, nom: 'c', identite: c.pub, admisPar: A, le: 'x' },
      { id: D, nom: 'd', identite: d.pub, admisPar: A, le: 'x' },
      { id: B, nom: 'b', identite: d.pub, admisPar: A, le: 'x' },
    ];
    expect(a.charte.filtrerAdmissions(liste).map((x) => x.id)).toEqual([C]);
  });

  test('appairage : chef admet d’office un membre connu, demande pour un inconnu ; non-chef refuse', async () => {
    const { a, b } = await reseau();
    const inconnu = await noeud(D);
    expect(a.charte.suiteAppairage(presentation(b))).toBe('accord');
    expect(a.charte.suiteAppairage(presentation(inconnu))).toBe('demande');
    expect(b.charte.suiteAppairage(presentation(inconnu))).toBe('refus');
    expect(b.charte.suiteAppairage(presentation(a))).toBe('accord');
    const seul = await noeud(C);
    expect(seul.charte.suiteAppairage(presentation(inconnu))).toBe('demande');
  });

  test('droits : sans charte tout est permis ; un absent de la charte n’a rien', async () => {
    const { a } = await reseau();
    const autonome = await noeud(D);
    expect(autonome.charte.autorise(B, { genre: 'ecrire' })).toBe(true);
    expect(a.charte.autorise(D, { genre: 'fil' })).toBe(false);
    expect(a.charte.autorise(B, { genre: 'ouvrir' })).toBe(true);
  });

  test('admettre : un chef ajoute le nouveau membre ; une identité qui ne concorde pas est refusée', async () => {
    const { a } = await reseau();
    const nouveau = await noeud(D);
    expect(await a.charte.admettre(D, presentation(nouveau))).toBe(true);
    expect(a.charte.charte()?.membres.find((m) => m.id === D)?.sorte).toBe('serveur');
    expect(await a.charte.admettre(B, presentation(nouveau))).toBe(false);
  });
});
