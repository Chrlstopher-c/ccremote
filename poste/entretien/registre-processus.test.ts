// Responsabilité : tests du registre des processus — fusion pure (descendants, restes vivants, oubli des morts) et E/S.
import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Logger } from 'pino';
import { ecrireRegistre, type EntreeRegistre, lireRegistre, nouveauRegistre } from './registre-processus.ts';

const JOURNAL = { warn: () => undefined } as unknown as Logger;

const ANCIEN: EntreeRegistre = { pid: 100, debut: '5000', session: null, lancement: 'vieux' };

describe('fusion du registre', () => {
  test('les descendants actuels prennent le lancement courant ; un reste vivant garde le sien', () => {
    const vivant = (pid: number, debut: string) => pid === 100 && debut === '5000';
    const { registre, restes } = nouveauRegistre(
      [ANCIEN],
      [{ pid: 200, debut: '7000', session: 'sess-1' }],
      'courant',
      vivant,
    );
    expect(registre).toEqual([
      { pid: 200, debut: '7000', session: 'sess-1', lancement: 'courant' },
      ANCIEN,
    ]);
    expect(restes).toEqual([ANCIEN]);
  });

  test('un PID réutilisé (heure de démarrage différente) n’est pas un reste', () => {
    const { registre, restes } = nouveauRegistre([ANCIEN], [], 'courant', () => true);
    expect(restes).toEqual([ANCIEN]);
    const { registre: r2 } = nouveauRegistre([ANCIEN], [], 'courant', (pid, debut) => pid === 100 && debut === '9999');
    expect(r2).toEqual([]);
    expect(registre).toHaveLength(1);
  });

  test('un descendant déjà connu sous le même PID et heure n’est pas doublonné', () => {
    const { registre, restes } = nouveauRegistre(
      [{ pid: 300, debut: '1', session: null, lancement: 'vieux' }],
      [{ pid: 300, debut: '1', session: null }],
      'courant',
      () => true,
    );
    expect(registre).toEqual([{ pid: 300, debut: '1', session: null, lancement: 'courant' }]);
    expect(restes).toEqual([]);
  });
});

describe('E/S du registre', () => {
  test('écriture en 0600, relecture identique ; absent ou abîmé → vide', () => {
    const dossier = mkdtempSync(join(tmpdir(), 'registre-'));
    const chemin = join(dossier, 'processus.json');
    try {
      expect(lireRegistre(chemin, JOURNAL)).toEqual([]);
      ecrireRegistre(chemin, [ANCIEN], JOURNAL);
      expect(statSync(chemin).mode & 0o777).toBe(0o600);
      expect(lireRegistre(chemin, JOURNAL)).toEqual([ANCIEN]);
      writeFileSync(chemin, '{"pas": "un tableau"}');
      expect(lireRegistre(chemin, JOURNAL)).toEqual([]);
      expect(readFileSync(chemin, 'utf8')).toContain('pas');
    } finally {
      rmSync(dossier, { recursive: true, force: true });
    }
  });
});
