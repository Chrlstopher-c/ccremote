/**
 * Test de l'acceptation (a) — non-blocage MÉCANIQUE, pas discipline d'écriture.
 * ☠ CASSE couvert : un port qui ne répond jamais ne doit jamais faire attendre
 * l'appelant plus que le plafond fixé.
 */

import { describe, expect, test } from 'bun:test';
import { avecPlafond } from './plafond.ts';

describe('avecPlafond', () => {
  test('résout avec la valeur quand le port répond avant le plafond', async () => {
    const resultat = await avecPlafond(Promise.resolve('valeur'), 50);
    expect(resultat).toEqual({ etat: 'resolu', valeur: 'valeur' });
  });

  test('☠ un port qui ne répond JAMAIS ne bloque pas au-delà du plafond', async () => {
    const jamais = new Promise<string>(() => {
      /* ne se résout jamais — simule un worker mort ou un lien coupé */
    });
    const debut = Date.now();
    const resultat = await avecPlafond(jamais, 30);
    const duree = Date.now() - debut;
    expect(resultat).toEqual({ etat: 'delai_depasse' });
    expect(duree).toBeLessThan(200);
  });

  test('un port lent mais sous le plafond résout normalement', async () => {
    const lent = new Promise<number>((resolve) => setTimeout(() => resolve(42), 10));
    const resultat = await avecPlafond(lent, 200);
    expect(resultat).toEqual({ etat: 'resolu', valeur: 42 });
  });
});
