/**
 * Registre en mémoire — protège la double indexation (sessionId / missionId) et
 * la survie d'un enregistrement mort (nécessaire à la relance, B.3.3).
 */

import { describe, expect, test } from 'bun:test';
import { RegistreWorkers } from './registre-workers.ts';
import type { EnregistrementWorker } from './types.ts';

function enregistrement(overrides: Partial<EnregistrementWorker> = {}): EnregistrementWorker {
  return {
    missionId: 'mission-1',
    sessionId: 'session-1',
    epoch: 1,
    worktree: '/tmp/worktree-alpha',
    // Casts minimaux : ce module ne lit jamais l'intérieur de `spec`/`handle`/`entree`.
    spec: {} as EnregistrementWorker['spec'],
    handle: {} as EnregistrementWorker['handle'],
    entree: {} as EnregistrementWorker['entree'],
    vivant: true,
    ...overrides,
  };
}

describe('RegistreWorkers', () => {
  test('retrouve un enregistrement par session et par mission', () => {
    const registre = new RegistreWorkers();
    registre.enregistrer(enregistrement());
    expect(registre.parSession('session-1')?.missionId).toBe('mission-1');
    expect(registre.parMission('mission-1')?.sessionId).toBe('session-1');
  });

  test('mission ou session inconnue rend null, jamais une exception', () => {
    const registre = new RegistreWorkers();
    expect(registre.parSession('inconnue')).toBeNull();
    expect(registre.parMission('inconnue')).toBeNull();
  });

  test('marquerMort bascule vivant à false sans retirer l’enregistrement', () => {
    const registre = new RegistreWorkers();
    registre.enregistrer(enregistrement());
    registre.marquerMort('session-1');
    const enr = registre.parSession('session-1');
    expect(enr).not.toBeNull();
    expect(enr?.vivant).toBe(false);
  });

  test('marquerMort sur une session inconnue ne lève rien', () => {
    const registre = new RegistreWorkers();
    expect(() => registre.marquerMort('inconnue')).not.toThrow();
  });

  test('remplacer réindexe missionId vers le nouvel enregistrement (relance)', () => {
    const registre = new RegistreWorkers();
    registre.enregistrer(enregistrement({ sessionId: 'session-1', vivant: false }));
    registre.remplacer(enregistrement({ sessionId: 'session-1', epoch: 2, vivant: true }));
    const enr = registre.parMission('mission-1');
    expect(enr?.vivant).toBe(true);
    expect(enr?.epoch).toBe(2);
  });

  test('tous() reflète l’état vivant/mort courant, sans filtrage (B.1.4 : le PC fait autorité)', () => {
    const registre = new RegistreWorkers();
    registre.enregistrer(enregistrement({ sessionId: 's1', missionId: 'm1' }));
    registre.enregistrer(enregistrement({ sessionId: 's2', missionId: 'm2', vivant: false }));
    expect(registre.tous().map((e) => e.sessionId).sort()).toEqual(['s1', 's2']);
  });
});
