import { describe, expect, test } from 'bun:test';
import { avecEnteteChris, ENTETE_CHRIS, sansEnteteChris } from './entete-chris.ts';

describe('en-tête des messages de Chris', () => {
  test('ajouté une seule fois, retiré à l’affichage', () => {
    const marque = avecEnteteChris('Salut');
    expect(marque).toBe(`${ENTETE_CHRIS}\nSalut`);
    expect(avecEnteteChris(marque)).toBe(marque);
    expect(sansEnteteChris(marque)).toBe('Salut');
    expect(sansEnteteChris('Salut')).toBe('Salut');
  });
});
