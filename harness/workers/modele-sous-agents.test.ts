import { describe, expect, test } from 'bun:test';
import type { SyncHookJSONOutput } from '@anthropic-ai/claude-agent-sdk';
import { construireHookModeleSousAgents, MODELE_SOUS_AGENT_IMPOSE } from './modele-sous-agents.ts';

/**
 * Verrou dur A1 : tout sous-agent Task tourne sur Sonnet, quoi que le lead
 * demande. `☠` PREUVE DANS LES DEUX SENS : le champ `model` de l'entrée change,
 * la sortie du hook le ramène toujours à `sonnet` ; un `fork` (qui ignore
 * `model`) est refusé ; les outils qui ne sont pas `Task` passent intacts.
 */
const hook = construireHookModeleSousAgents();

function appeler(toolName: string, toolInput: unknown): Promise<SyncHookJSONOutput> {
  return hook(
    {
      hook_event_name: 'PreToolUse',
      tool_name: toolName,
      tool_input: toolInput,
      tool_use_id: 'tu',
      session_id: 's',
      cwd: '/mnt/projects/.worktrees/equipe-x',
      transcript_path: '',
      permission_mode: 'bypassPermissions',
    } as unknown as Parameters<typeof hook>[0],
    'tu',
    { signal: new AbortController().signal },
  ) as Promise<SyncHookJSONOutput>;
}

function updatedInput(sortie: SyncHookJSONOutput): Record<string, unknown> | undefined {
  return (sortie.hookSpecificOutput as { updatedInput?: Record<string, unknown> } | undefined)?.updatedInput;
}

function decision(sortie: SyncHookJSONOutput): { permissionDecision?: string; permissionDecisionReason?: string } | undefined {
  return sortie.hookSpecificOutput as { permissionDecision?: string; permissionDecisionReason?: string } | undefined;
}

describe('construireHookModeleSousAgents (verrou A1)', () => {
  test('Task sans `model` (héritage Opus du lead) ⇒ réécrit en sonnet', async () => {
    const sortie = await appeler('Task', { description: 'x', prompt: 'écris les tests' });
    expect(updatedInput(sortie)?.['model']).toBe(MODELE_SOUS_AGENT_IMPOSE);
    expect(MODELE_SOUS_AGENT_IMPOSE).toBe('sonnet');
  });

  test('☠ Task avec `model: opus` explicite ⇒ écrasé en sonnet (l’override ne passe pas)', async () => {
    const sortie = await appeler('Task', { description: 'x', prompt: 'y', model: 'opus' });
    expect(updatedInput(sortie)?.['model']).toBe('sonnet');
  });

  test('☠ l’outil RÉEL `Agent` (SDK 0.3.220, mesuré 03/09) avec model opus ⇒ écrasé en sonnet', async () => {
    const sortie = await appeler('Agent', { description: 'x', prompt: 'y', model: 'opus' });
    expect(updatedInput(sortie)?.['model']).toBe('sonnet');
  });

  test('☠ `Agent` de type fork ⇒ REFUSÉ (comme Task)', async () => {
    const sortie = await appeler('Agent', { description: 'x', prompt: 'y', subagent_type: 'fork' });
    expect(decision(sortie)?.permissionDecision).toBe('deny');
  });

  test('les autres champs de l’entrée sont PRÉSERVÉS — seul model est réécrit', async () => {
    const sortie = await appeler('Task', {
      description: 'audit',
      prompt: 'longue consigne',
      subagent_type: 'general-purpose',
      model: 'haiku',
      run_in_background: true,
    });
    const rewrite = updatedInput(sortie);
    expect(rewrite).toEqual({
      description: 'audit',
      prompt: 'longue consigne',
      subagent_type: 'general-purpose',
      model: 'sonnet',
      run_in_background: true,
    });
  });

  test('☠ un sous-agent `fork` est REFUSÉ — il hériterait de l’Opus du lead et ignore model', async () => {
    const sortie = await appeler('Task', { description: 'x', prompt: 'y', subagent_type: 'fork' });
    expect(decision(sortie)?.permissionDecision).toBe('deny');
    // Le motif est actionnable : il dit au lead quoi faire à la place.
    expect(decision(sortie)?.permissionDecisionReason).toContain('fork');
    expect(decision(sortie)?.permissionDecisionReason).toContain('Sonnet');
    // Un deny ne réécrit rien.
    expect(updatedInput(sortie)).toBeUndefined();
  });

  test('un outil qui n’est PAS Task passe intact — aucune décision, aucune réécriture', async () => {
    for (const outil of ['Bash', 'Write', 'Edit', 'TaskStop', 'TaskOutput']) {
      const sortie = await appeler(outil, { command: 'echo hi', model: 'opus' });
      expect(sortie.hookSpecificOutput).toBeUndefined();
    }
  });

  test('entrée non-objet (défensif) ⇒ force quand même un model sonnet', async () => {
    const sortie = await appeler('Task', null);
    expect(updatedInput(sortie)?.['model']).toBe('sonnet');
  });
});
