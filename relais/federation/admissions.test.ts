// Fusion des admissions d'appareils reçues d'un pair : ajout, révocation définitive, conflit de clé, identifiant de
// nœud refusé, source non appariée ou d'un autre propriétaire. Fonctions pures : aucun réseau.
import { describe, expect, test } from 'bun:test';
import { fusionner, noeudsAnnonces, photoAdmissions, verdictSource } from './admissions.ts';
import type { PairFederee } from './secrets.ts';

const MOI = '111111111111';
const PAIR_NOEUD = '222222222222';
const APPAREIL = 'aaaaaaaaaaaa';
const AUTRE_APPAREIL = 'bbbbbbbbbbbb';
const CLE = 'a'.repeat(86);
const CLE_AUTRE = 'b'.repeat(86);
const DATE = '2026-11-22T10:00:00.000Z';

const noeud = (id: string, nom: string): PairFederee => ({ id, nom, identite: CLE, creeLe: DATE, genre: 'noeud' });
const appareil = (id: string, identite = CLE, admisPar = MOI): PairFederee => ({
  id,
  nom: 'iphone',
  identite,
  creeLe: DATE,
  genre: 'appareil',
  admisPar,
});
const admis = (id: string, identite = CLE, admisPar = MOI) => ({ id, nom: 'iphone', identite, admisPar, le: DATE });

describe('photo des admissions', () => {
  test('ne porte que les appareils (pas les nœuds), avec leur admission et les révocations', () => {
    const photo = photoAdmissions([noeud(PAIR_NOEUD, 'tour'), appareil(APPAREIL)], [AUTRE_APPAREIL], MOI);
    expect(photo.liste).toEqual([admis(APPAREIL)]);
    expect(photo.retires).toEqual([AUTRE_APPAREIL]);
  });

  test('un appareil sans admisPar enregistré est attribué à ce nœud', () => {
    const sans: PairFederee = { id: APPAREIL, nom: 'iphone', identite: CLE, creeLe: DATE, genre: 'appareil' };
    expect(photoAdmissions([sans], [], MOI).liste[0]?.admisPar).toBe(MOI);
  });
});

describe('fusion d’une photo reçue', () => {
  test('un appareil admis ailleurs est ajouté, avec le nœud qui l’a admis', () => {
    const photo = { liste: [admis(APPAREIL, CLE, PAIR_NOEUD)], retires: [] };
    const f = fusionner(photo, [noeud(PAIR_NOEUD, 'tour')], [], MOI);
    expect(f.ajoutes).toEqual([APPAREIL]);
    expect(f.changee).toBe(true);
    expect(f.pairs.find((p) => p.id === APPAREIL)).toMatchObject({ genre: 'appareil', admisPar: PAIR_NOEUD });
  });

  test('une photo déjà connue ne change rien (pas de relais en boucle)', () => {
    const f = fusionner({ liste: [admis(APPAREIL)], retires: [] }, [appareil(APPAREIL)], [], MOI);
    expect(f.ajoutes).toEqual([]);
    expect(f.changee).toBe(false);
  });

  test('une révocation retire l’appareil et bloque toute admission future de cet identifiant', () => {
    const pairs = [noeud(PAIR_NOEUD, 'tour'), appareil(APPAREIL)];
    const f = fusionner({ liste: [], retires: [APPAREIL] }, pairs, [], MOI);
    expect(f.retires).toEqual([APPAREIL]);
    expect(f.pairs.some((p) => p.id === APPAREIL)).toBe(false);
    expect(f.revoques).toEqual([APPAREIL]);
    const reprise = fusionner({ liste: [admis(APPAREIL)], retires: [] }, f.pairs, f.revoques, MOI);
    expect(reprise.ajoutes).toEqual([]);
    expect(reprise.pairs.some((p) => p.id === APPAREIL)).toBe(false);
  });

  test('une révocation d’un appareil inconnu est mémorisée : une admission périmée reste refusée', () => {
    const f = fusionner({ liste: [admis(APPAREIL)], retires: [APPAREIL] }, [], [], MOI);
    expect(f.ajoutes).toEqual([]);
    expect(f.changee).toBe(true);
    expect(f.revoques).toContain(APPAREIL);
  });

  test('un identifiant qui désigne un de nos nœuds ne devient jamais un appareil ni une révocation', () => {
    const pairs = [noeud(PAIR_NOEUD, 'tour')];
    const f = fusionner({ liste: [admis(PAIR_NOEUD)], retires: [PAIR_NOEUD] }, pairs, [], MOI);
    expect(f.pairs).toEqual(pairs);
    expect(f.revoques).toEqual([]);
    expect(f.changee).toBe(false);
  });

  test('une admission qui arrive avec une autre clé que celle connue n’écrase rien et est signalée', () => {
    const f = fusionner({ liste: [admis(APPAREIL, CLE_AUTRE)], retires: [] }, [appareil(APPAREIL, CLE)], [], MOI);
    expect(f.conflits).toEqual([APPAREIL]);
    expect(f.pairs.find((p) => p.id === APPAREIL)?.identite).toBe(CLE);
    expect(f.changee).toBe(false);
  });

  test('notre propre identifiant n’est jamais ajouté comme appareil', () => {
    const f = fusionner({ liste: [admis(MOI)], retires: [] }, [], [], MOI);
    expect(f.ajoutes).toEqual([]);
  });

  test('deux appareils admis à la fois : les deux sont rangés', () => {
    const f = fusionner({ liste: [admis(APPAREIL), admis(AUTRE_APPAREIL)], retires: [] }, [], [], MOI);
    expect(f.ajoutes.sort()).toEqual([APPAREIL, AUTRE_APPAREIL].sort());
  });
});

describe('source d’une photo', () => {
  test('un nœud apparié du même propriétaire est accepté', () => {
    expect(verdictSource([noeud(PAIR_NOEUD, 'tour')], PAIR_NOEUD, null)).toBe('accepte');
  });

  test('un membre non apparié est refusé, même si son propriétaire est le nôtre', () => {
    expect(verdictSource([], PAIR_NOEUD, null)).toBe('non-appaire');
  });

  test('un appareil apparié n’envoie jamais de photo : il n’est pas un nœud', () => {
    expect(verdictSource([appareil(APPAREIL)], APPAREIL, null)).toBe('non-appaire');
  });

  test('un nœud apparié d’un autre propriétaire est refusé', () => {
    const pairs = [noeud(PAIR_NOEUD, 'tour')];
    expect(verdictSource(pairs, PAIR_NOEUD, 'ce nœud n’est pas à toi')).toBe('autre-proprietaire');
  });
});

describe('nœuds présentés à un appareil admis', () => {
  test('soi-même d’abord, puis les nœuds appariés ; jamais les appareils', () => {
    const moi = { id: MOI, nom: 'portable', identite: CLE };
    const liste = noeudsAnnonces([noeud(PAIR_NOEUD, 'tour'), appareil(APPAREIL)], moi);
    expect(liste).toEqual([moi, { id: PAIR_NOEUD, nom: 'tour', identite: CLE }]);
  });

  test('sans identité locale connue, seuls les nœuds appariés sont présentés', () => {
    expect(noeudsAnnonces([noeud(PAIR_NOEUD, 'tour')], null)).toEqual([{ id: PAIR_NOEUD, nom: 'tour', identite: CLE }]);
  });
});
