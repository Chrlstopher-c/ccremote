/**
 * Preuve H-74 (5e occurrence) : `buildAuditHooks` branche réellement le port
 * d'audit sur des `HookCallback` invoquables, et garantit qu'aucune panne de
 * l'audit — port qui lève, callback qui lève ou qui rejette — ne bloque ni ne
 * fait échouer le tour (propriété n°1 du harness).
 */

import { describe, expect, test } from 'bun:test';
import type { HookCallbackMatcher, HookEvent, PreToolUseHookInput } from '@anthropic-ai/claude-agent-sdk';
import { buildAuditHooks } from './audit-hooks.ts';
import type { WorkerSpec } from './types.ts';

function spec(overrides: Partial<WorkerSpec> = {}): WorkerSpec {
  return {
    sessionId: '11111111-2222-3333-4444-555555555555',
    cwd: '/tmp/worktree-alpha',
    mandate: 'Tu es team leader.',
    deniedToolPatterns: [],
    maxBudgetUsd: 25,
    mcpServers: {}, portAuditPermissions: () => ({}),
    ...overrides,
  };
}

const OPTIONS_HOOK = { signal: new AbortController().signal };

function preToolUseInput(overrides: Partial<PreToolUseHookInput> = {}): PreToolUseHookInput {
  return {
    hook_event_name: 'PreToolUse',
    session_id: '11111111-2222-3333-4444-555555555555',
    transcript_path: '/tmp/transcript.jsonl',
    cwd: '/tmp/worktree-alpha',
    tool_name: 'Bash',
    tool_input: { command: 'ls' },
    tool_use_id: 'tool-use-1',
    ...overrides,
  };
}

describe('buildAuditHooks — câblage réel (H-74)', () => {
  test('les callbacks rendus par le port sont invoqués tels quels sur le chemin nominal', async () => {
    const vues: string[] = [];
    const hooks = buildAuditHooks(
      spec({
        portAuditPermissions: () => ({
          PreToolUse: [{ hooks: [async (input) => {
            if (input.hook_event_name === 'PreToolUse') vues.push(input.tool_name);
            return {};
          }] }],
        }),
      }),
    );
    const callback = hooks.PreToolUse?.[0]?.hooks[0];
    expect(callback).toBeDefined();
    await callback?.(preToolUseInput(), 'tool-use-1', OPTIONS_HOOK);
    expect(vues).toEqual(['Bash']);
  });

  test('plusieurs événements et plusieurs matchers sont tous conservés', () => {
    const matchers: Partial<Record<HookEvent, HookCallbackMatcher[]>> = {
      PreToolUse: [{ hooks: [async () => ({})] }],
      PostToolUse: [{ hooks: [async () => ({})] }],
      PermissionDenied: [{ hooks: [async () => ({})] }],
    };
    const hooks = buildAuditHooks(spec({ portAuditPermissions: () => matchers }));
    expect(Object.keys(hooks).sort()).toEqual(['PermissionDenied', 'PostToolUse', 'PreToolUse']);
  });
});

describe('buildAuditHooks — non-blocage garanti (propriété n°1 du harness)', () => {
  test('☠ portAuditPermissions() qui lève rend un objet vide, jamais une exception', () => {
    const hooks = buildAuditHooks(
      spec({
        portAuditPermissions: () => {
          throw new Error('collecteur indisponible à la composition');
        },
      }),
    );
    expect(hooks).toEqual({});
  });

  test('☠ un callback qui lève de façon synchrone retombe sur une observation vide', async () => {
    const hooks = buildAuditHooks(
      spec({
        portAuditPermissions: () => ({
          PreToolUse: [{ hooks: [async () => {
            throw new Error('collecteur en panne au milieu du tour');
          }] }],
        }),
      }),
    );
    const resultat = await hooks.PreToolUse?.[0]?.hooks[0]?.(preToolUseInput(), 'tool-use-1', OPTIONS_HOOK);
    expect(resultat).toEqual({});
  });

  test('☠ un callback dont la promesse rejette retombe aussi sur une observation vide', async () => {
    const hooks = buildAuditHooks(
      spec({
        portAuditPermissions: () => ({
          PostToolUse: [{ hooks: [() => Promise.reject(new Error('rejet asynchrone'))] }],
        }),
      }),
    );
    const resultat = await hooks.PostToolUse?.[0]?.hooks[0]?.(
      { ...preToolUseInput(), hook_event_name: 'PostToolUse', tool_response: null } as never,
      'tool-use-1',
      OPTIONS_HOOK,
    );
    expect(resultat).toEqual({});
  });

  test('un matcher sans hooks (tableau vide) ne casse rien', () => {
    const hooks = buildAuditHooks(spec({ portAuditPermissions: () => ({ PreToolUse: [{ hooks: [] }] }) }));
    expect(hooks.PreToolUse).toEqual([{ hooks: [] }]);
  });
});
