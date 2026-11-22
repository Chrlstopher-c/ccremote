// Découpage et réassemblage des gros corps : ordre, morceau manquant, lien perdu, bornes par pair.
import { describe, expect, test } from 'bun:test';
import { TAILLE_MORCEAU_CARACTERES } from '../../commun/federation.ts';
import { decouper, nombreDeMorceaux, Reassemblage, tropGrandPourTransfert } from './transferts.ts';

const CORPS = 'ab'.repeat(TAILLE_MORCEAU_CARACTERES) + 'fin';

describe('découpage', () => {
  test('un corps se coupe en morceaux numérotés qui se réunissent à l’identique', () => {
    const morceaux = decouper('r1', CORPS);
    expect(morceaux).toHaveLength(nombreDeMorceaux(CORPS));
    expect(morceaux.map((m) => m.rang)).toEqual(morceaux.map((_, i) => i));
    const reassemblage = new Reassemblage();
    for (const m of morceaux) expect(reassemblage.recevoir('A', m)).toBe(true);
    expect(reassemblage.assembler('A', 'r1', morceaux.length)).toBe(CORPS);
  });

  test('un corps trop grand pour le plus grand transfert est refusé', () => {
    expect(tropGrandPourTransfert('x'.repeat(1000))).toBe(false);
    expect(tropGrandPourTransfert('x'.repeat(16 * 1024 * 1024 + 1))).toBe(true);
  });
});

describe('réassemblage', () => {
  test('un morceau hors d’ordre abandonne le transfert : rien à réunir', () => {
    const [premier, second] = decouper('r2', CORPS);
    const reassemblage = new Reassemblage();
    expect(reassemblage.recevoir('A', premier!)).toBe(true);
    expect(reassemblage.recevoir('A', { ...second!, rang: 5 })).toBe(false);
    expect(reassemblage.assembler('A', 'r2', 2)).toBeNull();
  });

  test('un morceau manquant : la réunion échoue, le transfert est effacé', () => {
    const reassemblage = new Reassemblage();
    reassemblage.recevoir('A', decouper('r3', CORPS)[0]!);
    expect(reassemblage.assembler('A', 'r3', 2)).toBeNull();
    expect(reassemblage.assembler('A', 'r3', 1)).toBeNull();
  });

  test('un lien perdu efface les transferts de ce pair seulement', () => {
    const reassemblage = new Reassemblage();
    reassemblage.recevoir('A', decouper('r4', CORPS)[0]!);
    reassemblage.recevoir('B', decouper('r4', CORPS)[0]!);
    reassemblage.oublier('A');
    expect(reassemblage.assembler('A', 'r4', 1)).toBeNull();
    expect(reassemblage.assembler('B', 'r4', 1)).toBe(CORPS.slice(0, TAILLE_MORCEAU_CARACTERES));
  });

  test('au plus 16 transferts en route par pair', () => {
    const reassemblage = new Reassemblage();
    const accordes = Array.from({ length: 17 }, (_, i) => reassemblage.recevoir('A', decouper(`t${i}`, CORPS)[0]!));
    expect(accordes.filter(Boolean)).toHaveLength(16);
  });
});

test('un corps coupé ne sépare jamais un couple de substituts, et se réunit à l’identique', () => {
  const corps = `${'a'.repeat(TAILLE_MORCEAU_CARACTERES - 1)}😀${'b'.repeat(10)}`;
  const morceaux = decouper('r1', corps);
  expect(morceaux.length).toBe(nombreDeMorceaux(corps));
  expect(morceaux.map((m) => m.corps).join('')).toBe(corps);
  for (const m of morceaux) expect(/[\ud800-\udbff]$/.test(m.corps)).toBe(false);
});
