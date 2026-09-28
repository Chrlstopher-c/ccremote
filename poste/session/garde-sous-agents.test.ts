import { describe, expect, test } from 'bun:test';
import { GardeSousAgents, MAX_SOUS_AGENTS_PAR_ETAPE } from './garde-sous-agents.ts';

describe('garde des sous-agents', () => {
  test('un outil ordinaire passe sans décision', () => {
    expect(new GardeSousAgents().decider('Bash', { command: 'ls' })).toEqual({});
  });

  test('Sonnet imposé au lancement', () => {
    const d = new GardeSousAgents().decider('Agent', { description: 'x', model: 'opus' });
    expect(d.hookSpecificOutput).toMatchObject({ updatedInput: { description: 'x', model: 'sonnet' } });
  });

  test('fork refusé', () => {
    const d = new GardeSousAgents().decider('Agent', { subagent_type: 'fork' });
    expect(d.hookSpecificOutput).toMatchObject({ permissionDecision: 'deny' });
  });

  test('plafond par étape, remis à zéro à l’étape suivante', () => {
    const g = new GardeSousAgents();
    for (let i = 0; i < MAX_SOUS_AGENTS_PAR_ETAPE; i++) g.decider('Agent', {});
    expect(g.decider('Agent', {}).hookSpecificOutput).toMatchObject({ permissionDecision: 'deny' });
    g.nouvelleEtape();
    expect(g.decider('Agent', {}).hookSpecificOutput).toMatchObject({ updatedInput: { model: 'sonnet' } });
  });
});
