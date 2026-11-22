import { describe, expect, test } from 'bun:test';
import { estMigrable } from './migration.ts';

const OBSERVEE = { terminal: true, pilotee: false, claudeSessionId: 'conv-1', annexe_de: null, invite: undefined };

describe('estMigrable', () => {
  test('session Desktop ou terminal observée, pas encore migrée : migrable', () => {
    expect(estMigrable(OBSERVEE, null)).toBe(true);
  });

  test('déjà migrée, pilotée par Lanterne, annexe, invitée ou sans conversation : refusée', () => {
    expect(estMigrable(OBSERVEE, 'nouvelle-1')).toBe(false);
    expect(estMigrable({ ...OBSERVEE, pilotee: true }, null)).toBe(false);
    expect(estMigrable({ ...OBSERVEE, annexe_de: 'parente' }, null)).toBe(false);
    expect(estMigrable({ ...OBSERVEE, invite: { membre: 'm', nom: 'n' } }, null)).toBe(false);
    expect(estMigrable({ ...OBSERVEE, claudeSessionId: null }, null)).toBe(false);
    expect(estMigrable({ ...OBSERVEE, terminal: false }, null)).toBe(false);
  });
});
