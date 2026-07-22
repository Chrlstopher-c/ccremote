/**
 * Revalidation pid+starttime (dette n°1, TODO.md). Aucune lecture `/proc` réelle
 * dans les tests de logique — `lireStarttimeProc` est testée séparément, à part,
 * contre le process courant (le seul pid dont on connaît la vie avec certitude).
 */

import { describe, expect, test } from 'bun:test';
import { lireStarttimeProc, revaliderProcess } from './revalidation-process.ts';

describe('revaliderProcess — trois issues exhaustives, jamais deux confondues', () => {
  test('pid et starttime absents ⇒ indetermine (aucune donnée pour trancher)', () => {
    expect(revaliderProcess(null, null)).toBe('indetermine');
  });

  test('pid présent mais starttime attendu absent ⇒ indetermine', () => {
    expect(revaliderProcess(1234, null, () => '999')).toBe('indetermine');
  });

  test('starttime attendu présent mais pid absent ⇒ indetermine', () => {
    expect(revaliderProcess(null, '999')).toBe('indetermine');
  });

  test('pid inexistant sur le système (lecteur rend null) ⇒ mort_confirme', () => {
    expect(revaliderProcess(999999, '12345', () => null)).toBe('mort_confirme');
  });

  test('pid existant, starttime identique ⇒ vivant_confirme', () => {
    expect(revaliderProcess(1234, '987654', () => '987654')).toBe('vivant_confirme');
  });

  test('☠ pid recyclé : existe mais starttime différent ⇒ mort_confirme, jamais vivant_confirme', () => {
    expect(revaliderProcess(1234, '987654', () => '111111')).toBe('mort_confirme');
  });

  test('le lecteur injecté reçoit exactement le pid demandé', () => {
    const pidsRecus: number[] = [];
    revaliderProcess(4242, '1', (pid) => {
      pidsRecus.push(pid);
      return '1';
    });
    expect(pidsRecus).toEqual([4242]);
  });
});

describe('lireStarttimeProc — lecture réelle de /proc/<pid>/stat', () => {
  test('le process courant (process.pid) a un starttime lisible et stable entre deux lectures', () => {
    const premiere = lireStarttimeProc(process.pid);
    const seconde = lireStarttimeProc(process.pid);
    expect(premiere).not.toBeNull();
    expect(premiere).toBe(seconde);
    expect(premiere).toMatch(/^\d+$/);
  });

  test('un pid quasi certainement inexistant rend null, jamais une exception', () => {
    expect(() => lireStarttimeProc(999999999)).not.toThrow();
    expect(lireStarttimeProc(999999999)).toBeNull();
  });
});
