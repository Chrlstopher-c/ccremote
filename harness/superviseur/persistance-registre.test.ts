/**
 * Persistance SQLite du registre (dette n°1, TODO.md). `:memory:` partout — pas de
 * fichier réel dans les tests unitaires.
 */

import { describe, expect, test } from 'bun:test';
import type { WorkerSpec } from '../workers/index.ts';
import { PersistanceRegistreSqlite } from './persistance-registre.ts';

function specFactice(overrides: Partial<WorkerSpec> = {}): WorkerSpec {
  return {
    sessionId: 's1',
    cwd: '/tmp/worktree-alpha',
    mandate: 'team leader',
    deniedToolPatterns: [],
    maxBudgetUsd: 25,
    ...overrides,
  };
}

describe('PersistanceRegistreSqlite', () => {
  test('sauvegarder puis tous() relit exactement ce qui a été écrit', () => {
    const persistance = new PersistanceRegistreSqlite({ chemin: ':memory:' });
    persistance.sauvegarder({
      sessionId: 's1',
      missionId: 'm1',
      worktree: '/tmp/worktree-alpha',
      epoch: 3,
      pid: 4242,
      pidStarttime: '987654',
      vivant: true,
      spec: specFactice(),
    });

    const lignes = persistance.tous();
    expect(lignes).toHaveLength(1);
    expect(lignes[0]).toMatchObject({
      sessionId: 's1',
      missionId: 'm1',
      worktree: '/tmp/worktree-alpha',
      epoch: 3,
      pid: 4242,
      pidStarttime: '987654',
      vivant: true,
    });
    expect(lignes[0]?.spec).toEqual(specFactice());
  });

  test('sauvegarder deux fois la même sessionId met à jour la ligne (ON CONFLICT), jamais de doublon', () => {
    const persistance = new PersistanceRegistreSqlite({ chemin: ':memory:' });
    persistance.sauvegarder({
      sessionId: 's1', missionId: 'm1', worktree: '/tmp/a', epoch: 1,
      pid: null, pidStarttime: null, vivant: true, spec: specFactice(),
    });
    persistance.sauvegarder({
      sessionId: 's1', missionId: 'm1', worktree: '/tmp/a', epoch: 2,
      pid: 100, pidStarttime: '1', vivant: true, spec: specFactice(),
    });

    const lignes = persistance.tous();
    expect(lignes).toHaveLength(1);
    expect(lignes[0]?.epoch).toBe(2);
    expect(lignes[0]?.pid).toBe(100);
  });

  test('marquerMort bascule vivant à false sans retirer la ligne', () => {
    const persistance = new PersistanceRegistreSqlite({ chemin: ':memory:' });
    persistance.sauvegarder({
      sessionId: 's1', missionId: 'm1', worktree: '/tmp/a', epoch: 1,
      pid: 100, pidStarttime: '1', vivant: true, spec: specFactice(),
    });
    persistance.marquerMort('s1');

    const lignes = persistance.tous();
    expect(lignes).toHaveLength(1);
    expect(lignes[0]?.vivant).toBe(false);
  });

  test('marquerMort sur une sessionId inconnue ne lève rien (pas de ligne à affecter)', () => {
    const persistance = new PersistanceRegistreSqlite({ chemin: ':memory:' });
    expect(() => persistance.marquerMort('inconnue')).not.toThrow();
    expect(persistance.tous()).toHaveLength(0);
  });

  test('pid et pidStarttime null sont persistés et relus tels quels (worker sans pid connu)', () => {
    const persistance = new PersistanceRegistreSqlite({ chemin: ':memory:' });
    persistance.sauvegarder({
      sessionId: 's1', missionId: 'm1', worktree: '/tmp/a', epoch: 1,
      pid: null, pidStarttime: null, vivant: true, spec: specFactice(),
    });
    const [ligne] = persistance.tous();
    expect(ligne?.pid).toBeNull();
    expect(ligne?.pidStarttime).toBeNull();
  });
});
