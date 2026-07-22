/**
 * Protège le critère (a) : le worker démarre et rapporte des capacités **lues**
 * dans `SDKSystemMessage.capabilities`, jamais supposées depuis une version.
 * Protège aussi l'ordre imposé de B.1.2 : rien ne spawne si le pré-vol ou le
 * plancher de modèle échoue.
 */

import { describe, expect, test } from 'bun:test';
import type { Options, Query, SDKMessage, SDKSystemMessage } from '@anthropic-ai/claude-agent-sdk';
import { ModelFloorError } from './model-floor.ts';
import { WorkerStartError, hasCapability, readCapabilities, startWorker } from './start-worker.ts';
import type { PreflightReport, QueryFn, WorkerSpec } from './types.ts';

const SESSION_ID = '11111111-2222-3333-4444-555555555555';

function initMessage(overrides: Partial<SDKSystemMessage> = {}): SDKSystemMessage {
  return {
    type: 'system',
    subtype: 'init',
    apiKeySource: 'oauth',
    claude_code_version: '2.1.217',
    cwd: '/tmp/worktree-alpha',
    tools: ['Bash', 'Read'],
    mcp_servers: [],
    model: 'claude-sonnet-4-6',
    permissionMode: 'auto',
    slash_commands: [],
    output_style: 'default',
    skills: [],
    plugins: [],
    uuid: SESSION_ID,
    session_id: SESSION_ID,
    ...overrides,
  };
}

/**
 * Justification du cast : M-01 n'exerce que l'itération du flux ; les méthodes de
 * contrôle de `Query` (interrupt, setModel, close…) relèvent de B.3/B.4 et ne sont
 * pas sur le chemin du démarrage. Un générateur suffit et évite tout spawn réel.
 */
function fakeQuery(messages: readonly SDKMessage[]): Query {
  async function* stream(): AsyncGenerator<SDKMessage, void> {
    for (const message of messages) yield message;
  }
  return stream() as unknown as Query;
}

function okPreflight(effectiveModel: string | null = 'opus'): PreflightReport {
  return {
    ok: true,
    cwd: '/tmp/worktree-alpha',
    loadedSources: ['user', 'project', 'local'],
    machineClaudeMdPath: '/home/op/.claude/CLAUDE.md',
    projectClaudeMdPaths: [],
    effectiveModel,
    failures: [],
  };
}

function spec(overrides: Partial<WorkerSpec> = {}): WorkerSpec {
  return {
    sessionId: SESSION_ID,
    cwd: '/tmp/worktree-alpha',
    mandate: 'team leader',
    deniedToolPatterns: ['Bash(rm -rf /*)'],
    maxBudgetUsd: 25,
    portAuditPermissions: () => ({}),
    ...overrides,
  };
}

describe('capacités', () => {
  test('sont lues depuis SDKSystemMessage.capabilities', async () => {
    const handle = await startWorker(spec(), 'go', {
      preflight: async () => okPreflight(),
      query: () => fakeQuery([initMessage({ capabilities: ['interrupt_receipt_v1'] })]),
    });
    expect(handle.capabilities.advertised).toEqual(['interrupt_receipt_v1']);
    expect(hasCapability(handle.capabilities, 'interrupt_receipt_v1')).toBe(true);
  });

  test('☠ une version récente ne fait apparaître aucune capacité non annoncée', async () => {
    const handle = await startWorker(spec(), 'go', {
      preflight: async () => okPreflight(),
      query: () => fakeQuery([initMessage({ claude_code_version: '2.1.217' })]),
    });
    expect(handle.capabilities.claudeCodeVersion).toBe('2.1.217');
    expect(handle.capabilities.advertised).toEqual([]);
    expect(hasCapability(handle.capabilities, 'interrupt_receipt_v1')).toBe(false);
  });

  test('readCapabilities ne dérive rien du numéro de version', () => {
    const capabilities = readCapabilities(initMessage({ capabilities: ['une_capacite_inconnue'] }));
    expect(capabilities.advertised).toEqual(['une_capacite_inconnue']);
    expect(capabilities.sessionId).toBe(SESSION_ID);
  });
});

describe('ordre de la séquence B.1.2', () => {
  test('un pré-vol en échec empêche tout spawn', async () => {
    let spawned = false;
    const failing: PreflightReport = {
      ...okPreflight(),
      ok: false,
      failures: [{ code: 'settings_cascade_empty', detail: 'test' }],
    };
    const start = startWorker(spec(), 'go', {
      preflight: async () => failing,
      query: () => {
        spawned = true;
        return fakeQuery([initMessage()]);
      },
    });
    await expect(start).rejects.toThrow(WorkerStartError);
    expect(spawned).toBe(false);
  });

  test("☠ un 'inherit' résolu sous le plancher empêche tout spawn", async () => {
    let spawned = false;
    const start = startWorker(spec({ model: 'inherit' }), 'go', {
      preflight: async () => okPreflight('haiku'),
      query: () => {
        spawned = true;
        return fakeQuery([initMessage()]);
      },
    });
    await expect(start).rejects.toThrow(ModelFloorError);
    expect(spawned).toBe(false);
  });

  test('un worktree refusé empêche tout spawn', async () => {
    let spawned = false;
    const start = startWorker(spec(), 'go', {
      preflight: async () => okPreflight(),
      verifyWorktree: async () => {
        throw new Error('worktree revendiqué par un autre worker');
      },
      query: () => {
        spawned = true;
        return fakeQuery([initMessage()]);
      },
    });
    await expect(start).rejects.toThrow(WorkerStartError);
    expect(spawned).toBe(false);
  });

  test('les options transmises au SDK portent la config du poste et PATH', async () => {
    let seen: Options | undefined;
    const query: QueryFn = (params) => {
      seen = params.options;
      return fakeQuery([initMessage()]);
    };
    await startWorker(spec({ configDir: '/opt/comptes/c2' }), 'go', {
      preflight: async () => okPreflight(),
      query,
    });
    expect(seen?.settingSources).toEqual(['user', 'project', 'local']);
    expect(seen?.env?.['PATH']).toBe(process.env['PATH']);
    expect(seen?.env?.['CLAUDE_CONFIG_DIR']).toBe('/opt/comptes/c2');
    expect(seen?.sessionId).toBe(SESSION_ID);
  });

  test('☠ `deps.resume` compose en `resume`, jamais `sessionId` (relance, B.3.3)', async () => {
    let seen: Options | undefined;
    const query: QueryFn = (params) => {
      seen = params.options;
      return fakeQuery([initMessage()]);
    };
    await startWorker(spec(), 'go', { preflight: async () => okPreflight(), query, resume: true });
    expect(seen?.resume).toBe(SESSION_ID);
    expect(seen?.sessionId).toBeUndefined();
  });
});

describe('flux', () => {
  test('le flux reste ouvert après la lecture du message init', async () => {
    const suite: SDKMessage = {
      ...initMessage(),
      subtype: 'init' as const,
      claude_code_version: '2.1.218',
    };
    const handle = await startWorker(spec(), 'go', {
      preflight: async () => okPreflight(),
      query: () => fakeQuery([initMessage(), suite]),
    });
    const next = await handle.query.next();
    expect(next.done).toBe(false);
  });

  test('un flux sans message init échoue au lieu de rester suspendu', async () => {
    const start = startWorker(spec(), 'go', {
      preflight: async () => okPreflight(),
      query: () => fakeQuery([]),
      initTimeoutMs: 50,
    });
    await expect(start).rejects.toThrow(WorkerStartError);
  });
});
