/**
 * Protège les pannes #18 (settingSources vide) et #19 (env sans process.env),
 * et vérifie la table B.1.3 : rien de plus que le structurel.
 */

import { describe, expect, test } from 'bun:test';
import type { Options } from '@anthropic-ai/claude-agent-sdk';
import { GardeBudgetError, RETRY_WATCHDOG_ENV } from '../budgets/index.ts';
import {
  AGENT_TEAMS_ENV,
  CONFIG_DIR_ENV,
  OptionsCompositionError,
  assertOptionsInvariants,
  buildWorkerEnv,
  composeWorkerOptions,
} from './options-composition.ts';
import type { ResolvedModel, WorkerSpec } from './types.ts';

const MODEL: ResolvedModel = {
  requested: 'sonnet',
  resolved: 'claude-sonnet-4-6',
  tier: 'sonnet',
  viaInheritance: false,
};

function spec(overrides: Partial<WorkerSpec> = {}): WorkerSpec {
  return {
    sessionId: '11111111-2222-3333-4444-555555555555',
    cwd: '/tmp/worktree-alpha',
    mandate: 'Tu es team leader. Critère d’arrêt : les tests E2E passent.',
    deniedToolPatterns: ['Bash(rm -rf /*)'],
    maxBudgetUsd: 25,
    portAuditPermissions: () => ({}),
    ...overrides,
  };
}

describe('env', () => {
  test('☠ préserve PATH — env remplace, il ne fusionne pas', () => {
    const env = buildWorkerEnv(spec());
    expect(env['PATH']).toBe(process.env['PATH']);
    expect(env['PATH']).toBeDefined();
  });

  test('pose CLAUDE_CONFIG_DIR sans perdre le reste de l’environnement (H-53)', () => {
    const env = buildWorkerEnv(spec({ configDir: '/opt/comptes/compte2' }));
    expect(env[CONFIG_DIR_ENV]).toBe('/opt/comptes/compte2');
    expect(env['PATH']).toBe(process.env['PATH']);
    expect(env['HOME']).toBe(process.env['HOME']);
  });

  test('Agent Teams reste hors ligne tant qu’une équipe ne le demande pas (H-14)', () => {
    expect(buildWorkerEnv(spec())[AGENT_TEAMS_ENV]).toBeUndefined();
    expect(buildWorkerEnv(spec({ agentTeams: true }))[AGENT_TEAMS_ENV]).toBe('1');
  });

  test('le structurel gagne sur extraEnv', () => {
    const env = buildWorkerEnv(spec({ configDir: '/a', extraEnv: { [CONFIG_DIR_ENV]: '/b', FOO: 'bar' } }));
    expect(env[CONFIG_DIR_ENV]).toBe('/a');
    expect(env['FOO']).toBe('bar');
  });

  test('☠ panne #15 (G.1.4) : CLAUDE_CODE_RETRY_WATCHDOG=1 sans budget actif lève', () => {
    expect(() =>
      buildWorkerEnv(spec({ maxBudgetUsd: Number.POSITIVE_INFINITY, extraEnv: { [RETRY_WATCHDOG_ENV]: '1' } })),
    ).toThrow(GardeBudgetError);
  });

  test('CLAUDE_CODE_RETRY_WATCHDOG=1 avec un maxBudgetUsd actif : autorisé', () => {
    const env = buildWorkerEnv(spec({ maxBudgetUsd: 25, extraEnv: { [RETRY_WATCHDOG_ENV]: '1' } }));
    expect(env[RETRY_WATCHDOG_ENV]).toBe('1');
  });
});

describe('composeWorkerOptions', () => {
  test('fixe exactement le structurel de B.1.3', () => {
    const { options } = composeWorkerOptions(spec(), MODEL);
    expect(options.sessionId).toBe('11111111-2222-3333-4444-555555555555');
    expect(options.cwd).toBe('/tmp/worktree-alpha');
    expect(options.permissionMode).toBe('auto');
    expect(options.disallowedTools).toEqual(['Bash(rm -rf /*)']);
    expect(options.maxBudgetUsd).toBe(25);
    expect(options.model).toBe('claude-sonnet-4-6');
    expect(options.includePartialMessages).toBe(true);
    expect(options.forwardSubagentText).toBe(true);
    expect(options.agentProgressSummaries).toBe(true);
    expect(options.abortController).toBeInstanceOf(AbortController);
    expect(typeof options.stderr).toBe('function');
  });

  test('☠ settingSources contient les trois tiers et n’est jamais vide', () => {
    const { options } = composeWorkerOptions(spec(), MODEL);
    expect(options.settingSources).toEqual(['user', 'project', 'local']);
  });

  test('systemPrompt en forme preset avec le mandat en append (H-44, H-52)', () => {
    const { options } = composeWorkerOptions(spec(), MODEL);
    expect(options.systemPrompt).toEqual({
      type: 'preset',
      preset: 'claude_code',
      append: 'Tu es team leader. Critère d’arrêt : les tests E2E passent.',
    });
  });

  test('ne fixe rien qui appartient au PC', () => {
    const { options } = composeWorkerOptions(spec(), MODEL);
    // `hooks` est délibérément retiré de cette liste (H-74, 5e occurrence
    // mesurée le même jour) : ce n'est PAS une customisation du poste (celle-là
    // vit dans les fichiers de settings, sdk.d.ts ~L5117, un mécanisme distinct
    // à base de commandes shell) mais le câblage structurel de l'audit de
    // permissions du harness lui-même (C.5, M-22) — voir le test dédié plus bas.
    for (const key of ['mcpServers', 'agents', 'plugins', 'thinking', 'effort', 'allowedTools']) {
      expect(options).not.toHaveProperty(key);
    }
  });

  test('☠ H-74 (5e occurrence) : hooks porte l’audit de permissions branché sur le port injecté', () => {
    const tentativesVues: string[] = [];
    const { options } = composeWorkerOptions(
      spec({
        portAuditPermissions: () => ({
          PreToolUse: [
            {
              hooks: [
                async (input) => {
                  if (input.hook_event_name === 'PreToolUse') tentativesVues.push(input.tool_name);
                  return {};
                },
              ],
            },
          ],
        }),
      }),
      MODEL,
    );
    expect(options.hooks).toBeDefined();
    const preToolUse = options.hooks?.PreToolUse;
    expect(preToolUse).toHaveLength(1);
    expect(preToolUse?.[0]?.hooks).toHaveLength(1);
  });

  test('☠ H-74 : portAuditPermissions() qui lève ne bloque ni ne fait échouer la composition', () => {
    expect(() =>
      composeWorkerOptions(
        spec({
          portAuditPermissions: () => {
            throw new Error('collecteur indisponible');
          },
        }),
        MODEL,
      ),
    ).not.toThrow();
  });

  test('☠ un hook d’audit qui lève à l’exécution ne bloque ni ne fait échouer le tour (propriété n°1)', async () => {
    const { options } = composeWorkerOptions(
      spec({
        portAuditPermissions: () => ({
          PreToolUse: [
            {
              hooks: [
                async () => {
                  throw new Error('collecteur en panne au milieu du tour');
                },
              ],
            },
          ],
        }),
      }),
      MODEL,
    );
    const callback = options.hooks?.PreToolUse?.[0]?.hooks[0];
    expect(callback).toBeDefined();
    const resultat = await callback?.(
      {
        hook_event_name: 'PreToolUse',
        tool_name: 'Bash',
        tool_input: { command: 'ls' },
        tool_use_id: 'tool-use-1',
        session_id: '11111111-2222-3333-4444-555555555555',
        transcript_path: '/tmp/transcript.jsonl',
        cwd: '/tmp/worktree-alpha',
      } as Parameters<NonNullable<typeof callback>>[0],
      'tool-use-1',
      { signal: new AbortController().signal },
    );
    // Jamais de deny, jamais d'exception propagée : observation vide sur panne.
    expect(resultat).toEqual({});
  });

  test('n’active le point d’extension distant que s’il est fourni (B.2.1)', () => {
    expect(composeWorkerOptions(spec(), MODEL).options.spawnClaudeCodeProcess).toBeUndefined();
  });

  test('l’abortController rendu est celui posé dans les options (B.2.2)', () => {
    const { options, abortController } = composeWorkerOptions(spec(), MODEL);
    expect(options.abortController).toBe(abortController);
  });

  test('☠ H-73.1 preuve (a) : canUseTool est toujours fourni, y compris en permissionMode "auto"', () => {
    const { options } = composeWorkerOptions(spec(), MODEL);
    expect(options.permissionMode).toBe('auto');
    expect(typeof options.canUseTool).toBe('function');
  });

  test('H-73.1 : canUseTool reste fourni en mode reprise également', () => {
    const { options } = composeWorkerOptions(spec(), MODEL, 'reprise');
    expect(typeof options.canUseTool).toBe('function');
  });
});

describe('mode reprise (B.3.3, relance)', () => {
  test('☠ `resume` remplace `sessionId`, jamais les deux (exclusivité SDK)', () => {
    const { options } = composeWorkerOptions(spec(), MODEL, 'reprise');
    expect(options.resume).toBe('11111111-2222-3333-4444-555555555555');
    expect(options.sessionId).toBeUndefined();
  });

  test('le mode par défaut reste `nouvelle` — aucune régression sur les appelants existants', () => {
    const { options } = composeWorkerOptions(spec(), MODEL);
    expect(options.sessionId).toBe('11111111-2222-3333-4444-555555555555');
    expect(options.resume).toBeUndefined();
  });

  test('le reste du structurel (plancher, denylist, budget) est inchangé en reprise', () => {
    const { options } = composeWorkerOptions(spec(), MODEL, 'reprise');
    expect(options.disallowedTools).toEqual(['Bash(rm -rf /*)']);
    expect(options.maxBudgetUsd).toBe(25);
    expect(options.settingSources).toEqual(['user', 'project', 'local']);
  });
});

describe('assertOptionsInvariants', () => {
  const base = (): Options => composeWorkerOptions(spec(), MODEL).options;

  test('rejette settingSources vide', () => {
    expect(() => assertOptionsInvariants({ ...base(), settingSources: [] })).toThrow(OptionsCompositionError);
    expect(() => assertOptionsInvariants({ ...base(), settingSources: undefined })).toThrow(
      OptionsCompositionError,
    );
  });

  test('rejette un env sans PATH', () => {
    expect(() => assertOptionsInvariants({ ...base(), env: { CLAUDE_CONFIG_DIR: '/x' } })).toThrow(
      OptionsCompositionError,
    );
  });

  test('rejette un systemPrompt qui n’est pas en forme preset', () => {
    expect(() => assertOptionsInvariants({ ...base(), systemPrompt: 'mandat brut' })).toThrow(
      OptionsCompositionError,
    );
  });
});
