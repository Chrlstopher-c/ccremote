// Responsabilité : tests des fonctions pures de la vague « reste » — extrait autour d'une occurrence, motif LIKE.
import { describe, expect, test } from 'bun:test';
import { echappementJson, extraitAutour, motifLike, normaliserEspaces } from './reste.ts';

describe('extrait autour d une occurrence', () => {
  test('retrouve la requête sans casse, avec sa position et sa longueur', () => {
    const e = extraitAutour('Bonjour le Monde', 'monde');
    expect(e).toEqual({ extrait: 'Bonjour le Monde', debut: 11, longueur: 5 });
  });

  test('normalise les espaces, retours à la ligne compris', () => {
    const e = extraitAutour('a\n\n  b   c', 'b c');
    expect(e?.extrait).toBe('a b c');
    expect(e?.extrait.slice(e.debut, e.debut + e.longueur)).toBe('b c');
  });

  test('borne l extrait à 200 caractères avec des « … » aux bords coupés', () => {
    const texte = `${'x'.repeat(300)}cible${'y'.repeat(300)}`;
    const e = extraitAutour(texte, 'cible');
    expect(e).not.toBeNull();
    expect(e?.extrait.length).toBeLessThanOrEqual(200);
    expect(e?.extrait.startsWith('…')).toBe(true);
    expect(e?.extrait.endsWith('…')).toBe(true);
    expect(e?.extrait.slice(e.debut, e.debut + e.longueur)).toBe('cible');
  });

  test('reste juste quand la casse change la longueur du texte', () => {
    const e = extraitAutour('Il fait ÉTÉ aujourd hui', 'été');
    expect(e?.extrait.slice(e.debut, e.debut + e.longueur)).toBe('ÉTÉ');
  });

  test('rend null sans occurrence ou pour une requête vide', () => {
    expect(extraitAutour('rien ici', 'absent')).toBeNull();
    expect(extraitAutour('rien ici', '   ')).toBeNull();
  });

  test('normaliserEspaces réduit et coupe les espaces', () => {
    expect(normaliserEspaces('  un\t\ndeux  ')).toBe('un deux');
  });
});

describe('motif LIKE du préfiltre', () => {
  test('échappe les caractères joker et les guillemets du JSON', () => {
    expect(motifLike('a_b')).toBe('%a!_b%');
    expect(echappementJson('"x"')).toBe('\\"x\\"');
    expect(motifLike('"x"')).toBe('%\\"x\\"%');
  });

  test('un caractère non ASCII devient un joker unique', () => {
    expect(motifLike('été')).toBe('%_t_%');
  });
});
