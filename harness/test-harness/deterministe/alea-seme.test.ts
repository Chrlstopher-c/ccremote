// L'aléa semé est ce qui rend reproductibles les pannes à motif « aléatoire »
// (perte d'octets sous charge, #27). Même graine ⇒ même suite, sans exception.

import { describe, expect, test } from 'bun:test';
import { AleaSeme } from './alea-seme.ts';

const suite = (graine: number, n: number): number[] => {
  const alea = new AleaSeme(graine);
  return Array.from({ length: n }, () => alea.suivant());
};

describe('AleaSeme — reproductibilité', () => {
  test('même graine, même suite', () => {
    expect(suite(1234, 32)).toEqual(suite(1234, 32));
  });

  test('graines différentes, suites différentes', () => {
    expect(suite(1, 16)).not.toEqual(suite(2, 16));
  });

  test('suivant reste dans [0, 1)', () => {
    const alea = new AleaSeme(7);
    for (let i = 0; i < 500; i += 1) {
      const v = alea.suivant();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  test('entier reste dans [0, borne) et vaut 0 sur borne nulle ou négative', () => {
    const alea = new AleaSeme(99);
    for (let i = 0; i < 200; i += 1) {
      const v = alea.entier(10);
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(10);
    }
    expect(alea.entier(0)).toBe(0);
    expect(alea.entier(-5)).toBe(0);
  });

  test('tirage borne les probabilités extrêmes', () => {
    const alea = new AleaSeme(4242);
    for (let i = 0; i < 100; i += 1) {
      expect(alea.tirage(0)).toBe(false);
      expect(alea.tirage(1)).toBe(true);
    }
  });

  test('une graine fixe produit un motif de tirages identique', () => {
    const motif = (): string => {
      const alea = new AleaSeme(2026);
      return Array.from({ length: 40 }, () => (alea.tirage(0.3) ? '1' : '0')).join('');
    };
    expect(motif()).toBe(motif());
  });
});
