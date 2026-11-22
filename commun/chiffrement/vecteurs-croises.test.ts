// Responsabilité : le JSON des vecteurs croisés (relu par les tests Swift) correspond exactement à la production.
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { produireVecteurs } from './vecteurs-croises.ts';

const FICHIER = `${import.meta.dir}/vecteurs-croises.json`;

describe('vecteurs croisés Bun ↔ Swift', () => {
  test('le fichier committé est exactement ce que produit la production, à graines fixées', async () => {
    const attendu: unknown = JSON.parse(readFileSync(FICHIER, 'utf8'));
    expect(await produireVecteurs()).toEqual(attendu as Record<string, unknown>);
  });

  test('deux productions successives sont identiques (aucun aléa hors graines)', async () => {
    expect(await produireVecteurs()).toEqual(await produireVecteurs());
  });
});
