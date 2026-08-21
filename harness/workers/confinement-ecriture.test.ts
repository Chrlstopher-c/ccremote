import { describe, expect, test } from 'bun:test';
import type { SyncHookJSONOutput } from '@anthropic-ai/claude-agent-sdk';
import { construireHookConfinementEcriture } from './confinement-ecriture.ts';

/**
 * Garde 3 (accès `rapport`) — le verrou RÉEL. `☠` PREUVE DANS LES DEUX SENS
 * exigée par le mandat : refus quand le chemin est hors du worktree, passage
 * quand il est dedans.
 */
describe('construireHookConfinementEcriture (garde 3)', () => {
  const hook = construireHookConfinementEcriture('/mnt/projects/.worktrees/equipe-x');

  test('Write hors du worktree ⇒ deny', async () => {
    const resultat = (await hook(
      {
        hook_event_name: 'PreToolUse',
        tool_name: 'Write',
        tool_input: { file_path: '/etc/passwd' },
        tool_use_id: 'tu-1',
        session_id: 's',
        cwd: '/mnt/projects/.worktrees/equipe-x',
        transcript_path: '',
        permission_mode: 'bypassPermissions',
      } as unknown as Parameters<typeof hook>[0],
      'tu-1',
      { signal: new AbortController().signal },
    )) as SyncHookJSONOutput;
    const sortie = resultat.hookSpecificOutput as { permissionDecision?: string; permissionDecisionReason?: string } | undefined;
    expect(sortie?.permissionDecision).toBe('deny');
    expect(sortie?.permissionDecisionReason).toContain('/etc/passwd');
  });

  test('Write DANS le worktree ⇒ aucune décision (autorisé)', async () => {
    const resultat = (await hook(
      {
        hook_event_name: 'PreToolUse',
        tool_name: 'Write',
        tool_input: { file_path: '/mnt/projects/.worktrees/equipe-x/rapport.md' },
        tool_use_id: 'tu-2',
        session_id: 's',
        cwd: '/mnt/projects/.worktrees/equipe-x',
        transcript_path: '',
        permission_mode: 'bypassPermissions',
      } as unknown as Parameters<typeof hook>[0],
      'tu-2',
      { signal: new AbortController().signal },
    )) as SyncHookJSONOutput;
    expect(resultat.hookSpecificOutput).toBeUndefined();
  });

  test('chemin RELATIF résolu contre le worktree, pas contre le cwd du process', async () => {
    const resultat = (await hook(
      {
        hook_event_name: 'PreToolUse',
        tool_name: 'Edit',
        tool_input: { file_path: 'sous-dossier/note.md' },
        tool_use_id: 'tu-3',
        session_id: 's',
        cwd: '/mnt/projects/.worktrees/equipe-x',
        transcript_path: '',
        permission_mode: 'bypassPermissions',
      } as unknown as Parameters<typeof hook>[0],
      'tu-3',
      { signal: new AbortController().signal },
    )) as SyncHookJSONOutput;
    expect(resultat.hookSpecificOutput).toBeUndefined();
  });

  test('Bash n’est PAS confiné par ce hook (H-58 documenté, hors périmètre de ce verrou)', async () => {
    const resultat = (await hook(
      {
        hook_event_name: 'PreToolUse',
        tool_name: 'Bash',
        tool_input: { command: 'rm -rf /' },
        tool_use_id: 'tu-4',
        session_id: 's',
        cwd: '/mnt/projects/.worktrees/equipe-x',
        transcript_path: '',
        permission_mode: 'bypassPermissions',
      } as unknown as Parameters<typeof hook>[0],
      'tu-4',
      { signal: new AbortController().signal },
    )) as SyncHookJSONOutput;
    expect(resultat.hookSpecificOutput).toBeUndefined();
  });

  test('file_path illisible ⇒ FAIL-CLOSED, deny', async () => {
    const resultat = (await hook(
      {
        hook_event_name: 'PreToolUse',
        tool_name: 'NotebookEdit',
        tool_input: {},
        tool_use_id: 'tu-5',
        session_id: 's',
        cwd: '/mnt/projects/.worktrees/equipe-x',
        transcript_path: '',
        permission_mode: 'bypassPermissions',
      } as unknown as Parameters<typeof hook>[0],
      'tu-5',
      { signal: new AbortController().signal },
    )) as SyncHookJSONOutput;
    const sortie = resultat.hookSpecificOutput as { permissionDecision?: string } | undefined;
    expect(sortie?.permissionDecision).toBe('deny');
  });
});
