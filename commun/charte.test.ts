// Responsabilité : tests de la charte signée — genèse, succession, refus, éditions, droits, reprise du parc.
import { describe, expect, test } from 'bun:test';
import { exporterIdentitePublique, genererIdentite, type Identite } from './chiffrement/identite.ts';
import {
  AUCUN_DROIT,
  TOUS_DROITS,
  ajouterMembre,
  autorise,
  changerMembre,
  creerCharte,
  type Charte,
  type CharteSignee,
  type Droit,
  type Droits,
  type Edition,
  droitRequis,
  droitsDe,
  lireCharte,
  type MembreCharte,
  nommerChef,
  repriseDuParc,
  repriseLEmporte,
  type RequeteDroit,
  retirerMembre,
  type Sorte,
  signerCharte,
  verifierCharte,
} from './charte.ts';

const RESEAU = '111111111111';
const LE = '2026-11-22T10:00:00.000Z';
const A = 'aaaaaaaaaaaa';
const B = 'bbbbbbbbbbbb';
const C = 'cccccccccccc';

interface Personne {
  readonly id: string;
  readonly cle: Identite;
  readonly publique: string;
}

async function personne(id: string): Promise<Personne> {
  const cle = await genererIdentite();
  return { id, cle, publique: exporterIdentitePublique(cle.publique) };
}

function membre(p: Personne, sorte: Sorte = 'pair', droits: Droits = TOUS_DROITS): MembreCharte {
  return { id: p.id, nom: `nom-${p.id}`, sorte, identite: p.publique, droits, compte: null };
}

function charteDe(
  membres: MembreCharte[],
  chefs: string[],
  version = 1,
  reseau = RESEAU,
  par = chefs[0] ?? '',
): Charte {
  return { format: 1, reseau, nom: 'Mon réseau', version, chefs, membres, le: LE, par, origine: 'creation' };
}

function signe(c: Charte, p: Personne): Promise<CharteSignee> {
  return signerCharte(c, p.cle.signaturePrivee);
}

function edition(e: Edition): Charte {
  if (!e.ok) throw new Error(`édition refusée : ${e.raison}`);
  return e.charte;
}

describe('genèse', () => {
  test('signée par son chef, vérifiée et rendue telle quelle', async () => {
    const a = await personne(A);
    const c = charteDe([membre(a)], [A]);
    expect(await verifierCharte(null, await signe(c, a))).toEqual({ ok: true, charte: c });
  });

  test('signée avec une autre clé que celle du chef : refusée', async () => {
    const a = await personne(A);
    const b = await personne(B);
    const c = charteDe([membre(a)], [A]);
    expect(await verifierCharte(null, await signe(c, b))).toEqual({ ok: false, motif: 'signature' });
  });
});

describe('succession', () => {
  test('version suivante signée par un chef de la version courante : acceptée', async () => {
    const a = await personne(A);
    const b = await personne(B);
    const v1 = charteDe([membre(a), membre(b)], [A, B]);
    const v2 = charteDe([membre(a), membre(b)], [A, B], 2, RESEAU, B);
    expect(await verifierCharte(v1, await signe(v2, b))).toEqual({ ok: true, charte: v2 });
  });

  test('signée par un pair devenu chef dans la proposition seulement : refusée', async () => {
    const a = await personne(A);
    const c = await personne(C);
    const v1 = charteDe([membre(a)], [A]);
    const v2 = charteDe([membre(a), membre(c)], [A, C], 2, RESEAU, C);
    expect(await verifierCharte(v1, await signe(v2, c))).toEqual({ ok: false, motif: 'signataire-non-chef' });
  });

  test('signée par un chef retiré en version courante (présent avant) : refusée', async () => {
    const a = await personne(A);
    const b = await personne(B);
    const v1 = charteDe([membre(a), membre(b)], [A, B]);
    const v2 = edition(retirerMembre(v1, A, B, LE));
    const v2Verifiee = await verifierCharte(v1, await signe(v2, a));
    expect(v2Verifiee.ok).toBe(true);
    if (!v2Verifiee.ok) return;
    const v3 = charteDe([membre(a), membre(b)], [A, B], 3, RESEAU, B);
    expect(await verifierCharte(v2Verifiee.charte, await signe(v3, b))).toEqual({
      ok: false,
      motif: 'signataire-non-chef',
    });
  });

  test('un caractère du texte altéré après signature : refusée', async () => {
    const a = await personne(A);
    const v1 = charteDe([membre(a)], [A]);
    const v2 = charteDe([membre(a)], [A], 2);
    const signee = await signe(v2, a);
    const altere = { ...signee, texte: signee.texte.replace('Mon réseau', 'Mon reseau') };
    expect(await verifierCharte(v1, altere)).toEqual({ ok: false, motif: 'signature' });
  });

  test('version égale ou inférieure à la courante : refusée', async () => {
    const a = await personne(A);
    const v2 = charteDe([membre(a)], [A], 2);
    const v1 = charteDe([membre(a)], [A], 1);
    expect(await verifierCharte(v2, await signe(v2, a))).toEqual({ ok: false, motif: 'ancienne' });
    expect(await verifierCharte(v2, await signe(v1, a))).toEqual({ ok: false, motif: 'ancienne' });
  });

  test('autre réseau : refusée', async () => {
    const a = await personne(A);
    const v1 = charteDe([membre(a)], [A]);
    const autre = charteDe([membre(a)], [A], 2, 'ffffffffffff');
    expect(await verifierCharte(v1, await signe(autre, a))).toEqual({ ok: false, motif: 'autre-reseau' });
  });

  test('clé du chef substituée dans la proposition (même id, clé de l attaquant) : refusée', async () => {
    const a = await personne(A);
    const attaquant = await personne(A);
    const v1 = charteDe([membre(a)], [A]);
    const forgee = charteDe([membre(attaquant)], [A], 2);
    expect(await verifierCharte(v1, await signe(forgee, attaquant))).toEqual({ ok: false, motif: 'signature' });
  });

  test('champ inconnu ajouté par une version future : accepté', async () => {
    const a = await personne(A);
    const v1 = charteDe([membre(a)], [A]);
    const v2 = charteDe([membre(a)], [A], 2);
    const futur = { ...v2, futur: 'version 2' };
    const verdict = await verifierCharte(v1, await signe(futur, a));
    expect(verdict.ok).toBe(true);
  });
});

describe('refus de cohérence', () => {
  test('sans chef : refusée', async () => {
    const a = await personne(A);
    expect(await verifierCharte(null, await signe(charteDe([membre(a)], []), a))).toEqual({
      ok: false,
      motif: 'sans-chef',
    });
  });

  test('chef de sorte serveur : refusée', async () => {
    const a = await personne(A);
    const s = await personne(C);
    const c = charteDe([membre(a), membre(s, 'serveur')], [A, C], 1, RESEAU, A);
    expect(await verifierCharte(null, await signe(c, a))).toEqual({ ok: false, motif: 'chef-invalide' });
  });

  test('chef absent des membres : refusée', async () => {
    const a = await personne(A);
    const c = charteDe([membre(a)], [A, C], 1, RESEAU, A);
    expect(await verifierCharte(null, await signe(c, a))).toEqual({ ok: false, motif: 'chef-invalide' });
  });

  test('identifiants de membres en double : refusée', async () => {
    const a = await personne(A);
    const c = charteDe([membre(a), membre(a)], [A]);
    expect(await verifierCharte(null, await signe(c, a))).toEqual({ ok: false, motif: 'doublon' });
  });

  test('signataire absent des chefs : refusée', async () => {
    const a = await personne(A);
    const b = await personne(B);
    const c = charteDe([membre(a), membre(b)], [A], 1, RESEAU, B);
    expect(await verifierCharte(null, await signe(c, b))).toEqual({ ok: false, motif: 'signataire-non-chef' });
  });

  test('lireCharte relit un texte cohérent et refuse le reste', async () => {
    const a = await personne(A);
    const c = charteDe([membre(a)], [A]);
    expect(lireCharte(JSON.stringify(c))).toEqual(c);
    expect(lireCharte('pas du json')).toBeNull();
    expect(lireCharte(JSON.stringify(charteDe([membre(a)], [A, A, C])))).toBeNull();
  });
});

describe('éditions', () => {
  test('creerCharte : version 1, moi chef pair avec tous les droits', async () => {
    const a = await personne(A);
    const c = creerCharte({
      reseau: RESEAU,
      nom: 'Mon réseau',
      moi: { id: A, nom: 'portable', identite: a.publique },
      le: LE,
    });
    expect(c.version).toBe(1);
    expect(c.origine).toBe('creation');
    expect(c.chefs).toEqual([A]);
    expect(c.membres).toEqual([
      { id: A, nom: 'portable', sorte: 'pair', identite: a.publique, droits: TOUS_DROITS, compte: null },
    ]);
  });

  test('nommerChef : la version suivante est signable et vérifiable', async () => {
    const a = await personne(A);
    const b = await personne(B);
    const v1 = charteDe([membre(a), membre(b)], [A]);
    const v2 = edition(nommerChef(v1, A, B, true, LE));
    expect(v2.version).toBe(2);
    expect(v2.chefs).toEqual([A, B]);
    expect(v2.par).toBe(A);
    expect(await verifierCharte(v1, await signe(v2, a))).toEqual({ ok: true, charte: v2 });
  });

  test('nommerChef refuse : auteur non chef, serveur, membre absent, auto-destitution', async () => {
    const a = await personne(A);
    const b = await personne(B);
    const s = await personne(C);
    const v1 = charteDe([membre(a), membre(b)], [A]);
    const deux = charteDe([membre(a), membre(b)], [A, B]);
    const avecServeur = charteDe([membre(a), membre(s, 'serveur')], [A]);
    expect(nommerChef(v1, B, A, false, LE).ok).toBe(false);
    expect(nommerChef(avecServeur, A, C, true, LE).ok).toBe(false);
    expect(nommerChef(v1, A, C, true, LE).ok).toBe(false);
    expect(nommerChef(deux, A, A, false, LE).ok).toBe(false);
    expect(nommerChef(v1, A, A, false, LE).ok).toBe(false);
  });

  test('ajouterMembre : ajout ; refus si déjà membre ou auteur non chef', async () => {
    const a = await personne(A);
    const b = await personne(B);
    const v1 = charteDe([membre(a)], [A]);
    const v2 = edition(ajouterMembre(v1, A, membre(b, 'telephone'), LE));
    expect(v2.membres.map((m) => m.id)).toEqual([A, B]);
    expect(ajouterMembre(v1, A, membre(a), LE).ok).toBe(false);
    const c = await personne(C);
    expect(ajouterMembre(charteDe([membre(a), membre(b)], [A, B]), B, membre(c), LE).ok).toBe(true);
    expect(ajouterMembre(charteDe([membre(a), membre(b)], [A]), B, membre(a), LE).ok).toBe(false);
  });

  test('retirerMembre : retire aussi des chefs ; refus du dernier chef', async () => {
    const a = await personne(A);
    const b = await personne(B);
    const v1 = charteDe([membre(a), membre(b)], [A, B]);
    const v2 = edition(retirerMembre(v1, A, B, LE));
    expect(v2.chefs).toEqual([A]);
    expect(v2.membres.map((m) => m.id)).toEqual([A]);
    expect(retirerMembre(charteDe([membre(a)], [A]), A, A, LE).ok).toBe(false);
    expect(retirerMembre(charteDe([membre(a), membre(b)], [A]), B, A, LE).ok).toBe(false);
  });

  test('changerMembre : droits et compte modifiés ; refus si auteur non chef', async () => {
    const a = await personne(A);
    const b = await personne(B);
    const v1 = charteDe([membre(a), membre(b)], [A]);
    const v2 = edition(changerMembre(v1, A, B, { droits: AUCUN_DROIT, compte: 'compte-1' }, LE));
    const cible = v2.membres.find((m) => m.id === B);
    expect(cible?.droits).toEqual(AUCUN_DROIT);
    expect(cible?.compte).toBe('compte-1');
    expect(changerMembre(v1, B, A, { nom: 'x' }, LE).ok).toBe(false);
  });

  test('repriseDuParc : origine reprise, sortes, droits, doublons ignorés, signable', async () => {
    const a = await personne(A);
    const b = await personne(B);
    const c = await personne(C);
    const reprise = repriseDuParc({
      reseau: RESEAU,
      nom: 'Mon réseau',
      moi: { id: A, nom: 'portable', identite: a.publique },
      noeuds: [
        { id: B, nom: 'tour', identite: b.publique },
        { id: A, nom: 'doublon', identite: b.publique },
      ],
      appareils: [{ id: C, nom: 'iphone', identite: c.publique }],
      le: LE,
    });
    expect(reprise.origine).toBe('reprise');
    expect(reprise.chefs).toEqual([A]);
    expect(reprise.membres.map((m) => [m.id, m.sorte])).toEqual([
      [A, 'pair'],
      [B, 'serveur'],
      [C, 'telephone'],
    ]);
    expect(reprise.membres.every((m) => m.droits.voir && m.droits.remoteControl)).toBe(true);
    expect(await verifierCharte(null, await signe(reprise, a))).toEqual({ ok: true, charte: reprise });
  });
});

describe('droits', () => {
  test('droitsDe : charte absente ou chef → tout ; absent → rien ; membre → ses droits', async () => {
    const a = await personne(A);
    const b = await personne(B);
    const c = charteDe([membre(a), { ...membre(b), droits: AUCUN_DROIT }], [A]);
    expect(droitsDe(null, B)).toEqual(TOUS_DROITS);
    expect(droitsDe(c, A)).toEqual(TOUS_DROITS);
    expect(droitsDe(c, C)).toEqual(AUCUN_DROIT);
    expect(droitsDe(c, B)).toEqual(AUCUN_DROIT);
    const piloteSeul = { ...AUCUN_DROIT, voir: true, piloter: true };
    expect(droitsDe(charteDe([membre(a), { ...membre(b), droits: piloteSeul }], [A]), B)).toEqual(piloteSeul);
  });

  test('droitRequis pour chaque forme de requête', () => {
    const cas: [RequeteDroit, Droit][] = [
      [{ genre: 'api', methode: 'GET', chemin: '/api/machines' }, 'voir'],
      [{ genre: 'api', methode: 'POST', chemin: '/api/sessions' }, 'lancer'],
      [{ genre: 'api', methode: 'POST', chemin: '/api/sessions/abc/remote-control' }, 'remoteControl'],
      [{ genre: 'api', methode: 'POST', chemin: '/api/sessions/abc/ecrire' }, 'piloter'],
      [{ genre: 'api', methode: 'DELETE', chemin: '/api/sessions/abc' }, 'piloter'],
      [{ genre: 'geste', methode: 'POST', suffixe: 'remote-control' }, 'remoteControl'],
      [{ genre: 'geste', methode: 'GET', suffixe: 'fil' }, 'voir'],
      [{ genre: 'geste', methode: 'POST', suffixe: 'ecrire' }, 'piloter'],
      [{ genre: 'fil' }, 'voir'],
      [{ genre: 'instantane' }, 'voir'],
      [{ genre: 'ecrire' }, 'piloter'],
      [{ genre: 'interrompre' }, 'piloter'],
      [{ genre: 'ouvrir' }, 'lancer'],
    ];
    for (const [requete, droit] of cas) expect(droitRequis(requete)).toBe(droit);
  });

  test('autorise : sans charte tout passe ; non-membre refusé ; droit retiré refusé', async () => {
    const a = await personne(A);
    const b = await personne(B);
    const c = charteDe([membre(a), { ...membre(b), droits: { ...TOUS_DROITS, piloter: false } }], [A]);
    expect(autorise(null, C, { genre: 'fil' })).toBe(true);
    expect(autorise(c, C, { genre: 'fil' })).toBe(false);
    expect(autorise(c, B, { genre: 'ecrire' })).toBe(false);
    expect(autorise(c, B, { genre: 'fil' })).toBe(true);
    expect(autorise(c, A, { genre: 'ecrire' })).toBe(true);
  });
});

describe('reprise concurrente', () => {
  test('la plus petite identifiant de réseau l emporte, seulement entre deux reprises v1', async () => {
    const a = await personne(A);
    const reprise = (reseau: string): Charte => ({
      ...charteDe([membre(a)], [A], 1, reseau),
      origine: 'reprise',
    });
    const grand = reprise('222222222222');
    const petit = reprise(RESEAU);
    expect(repriseLEmporte(grand, petit)).toBe(true);
    expect(repriseLEmporte(petit, grand)).toBe(false);
    expect(repriseLEmporte(petit, petit)).toBe(false);
    expect(repriseLEmporte({ ...grand, origine: 'creation' }, petit)).toBe(false);
  });
});
