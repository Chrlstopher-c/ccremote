/**
 * Câblage de l'observateur de flux (E.2, mission M-50) dans l'unique
 * consommateur du `Query` d'un worker (`#surveillerResultats`).
 *
 * Fichier séparé de `superviseur-workers.test.ts` (déjà à sa limite de
 * lignes) — duplication accidentelle assumée des fixtures minimales
 * (code-standards.md, DRY business vs accidentel).
 *
 * ☠ CASSE couvert : un futur ajout de type de message dans la boucle qui
 * oublierait de relayer à `observateurFlux` romprait ce test. Couvre aussi
 * H-72.3 (jamais bloquant, best-effort, isolé d'une exception de l'observateur).
 */

import { describe, expect, test } from 'bun:test';
import type { Query, SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { RegistreObservationParc } from '../control-plane/observabilite/index.ts';
import { CompteurRelances } from '../relance/compteur-relances.ts';
import type { WorkerCapabilities, WorkerHandle, WorkerSpec } from '../workers/index.ts';
import { SuperviseurWorkers } from './superviseur-workers.ts';
import type { DemandeDemarrage } from './types.ts';

function capacites(): WorkerCapabilities {
  return { advertised: [], claudeCodeVersion: '2.1.217', tools: ['Bash'], model: 'claude-sonnet-4-6', sessionId: 's' };
}

function fakeQuery(messages: readonly SDKMessage[]): Query {
  async function* flux(): AsyncGenerator<SDKMessage, void> {
    for (const message of messages) yield message;
  }
  const iterateur = flux();
  return Object.assign(iterateur, {
    interrupt: async () => ({ still_queued: [] }),
    close: (): void => {},
    reinitialize: async () => ({ commands: [], agents: [], models: [] }),
  }) as unknown as Query;
}

function spec(): WorkerSpec {
  return {
    sessionId: '11111111-2222-3333-4444-555555555555',
    cwd: '/tmp/worktree-alpha',
    mandate: 'team leader',
    // Audit inactif EXPLICITEMENT sur cette doublure (H-74) : jamais une omission.
    portAuditPermissions: () => ({}),
    deniedToolPatterns: [],
    maxBudgetUsd: 25,
  };
}

function demande(): DemandeDemarrage {
  return { missionId: 'mission-1', epoch: 1, spec: spec(), promptInitial: 'go' };
}

function demarrerWorkerFactice(messages: readonly SDKMessage[]) {
  return async (workerSpec: WorkerSpec): Promise<WorkerHandle> => ({
    sessionId: workerSpec.sessionId,
    cwd: workerSpec.cwd,
    capabilities: capacites(),
    model: { requested: 'sonnet', resolved: 'claude-sonnet-4-6' } as WorkerHandle['model'],
    preflight: {
      ok: true,
      cwd: workerSpec.cwd,
      loadedSources: [],
      machineClaudeMdPath: null,
      projectClaudeMdPaths: [],
      effectiveModel: null,
      failures: [],
    },
    pid: null,
    pidStarttime: null,
    abortController: new AbortController(),
    query: fakeQuery(messages),
  });
}

function assistantSimple(): SDKMessage {
  return {
    type: 'assistant',
    parent_tool_use_id: null,
    message: { content: [{ type: 'text', text: 'bonjour' }] },
    uuid: '11111111-2222-3333-4444-555555555555',
    session_id: spec().sessionId,
  } as unknown as SDKMessage;
}

function resultMessageOk(): SDKMessage {
  return {
    type: 'result',
    subtype: 'success',
    duration_ms: 1,
    duration_api_ms: 1,
    is_error: false,
    num_turns: 1,
    result: 'ok',
    stop_reason: null,
    total_cost_usd: 0.01,
    usage: {} as never,
    modelUsage: {},
    permission_denials: [],
    terminal_reason: 'completed' as never,
    uuid: '11111111-2222-3333-4444-555555555555',
    session_id: spec().sessionId,
  } as unknown as SDKMessage;
}

async function laisserPasserLesMicrotaches(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('câblage observateurFlux (E.2, M-50) dans #surveillerResultats', () => {
  test('chaque message du flux (hors result) est relayé, même ceux que le superviseur ignore par ailleurs', async () => {
    const registre = new RegistreObservationParc();
    registre.abonner('mission-1', 0, 'pilote', () => {});
    const superviseur = new SuperviseurWorkers({
      compteurRelances: new CompteurRelances(),
      observateurFlux: registre,
      demarrerWorker: demarrerWorkerFactice([assistantSimple(), resultMessageOk()]),
    });
    await superviseur.demarrer(demande());
    await laisserPasserLesMicrotaches();
    expect(registre.arbreDe('mission-1')?.ligne('principal')?.texteAccumule).toBe('bonjour');
  });

  test("un observateurFlux qui lève n'interrompt jamais la boucle de surveillance (best-effort)", async () => {
    const superviseur = new SuperviseurWorkers({
      compteurRelances: new CompteurRelances(),
      observateurFlux: {
        ingererMessageFlux: () => {
          throw new Error('client cassé');
        },
      },
      demarrerWorker: demarrerWorkerFactice([assistantSimple(), resultMessageOk()]),
    });
    await expect(superviseur.demarrer(demande())).resolves.toBeDefined();
    await laisserPasserLesMicrotaches();
    expect(superviseur.inventaire()[0]?.vivant).toBe(false);
  });

  test('sans observateurFlux fourni : aucune exception (port optionnel)', async () => {
    const superviseur = new SuperviseurWorkers({
      compteurRelances: new CompteurRelances(),
      demarrerWorker: demarrerWorkerFactice([assistantSimple(), resultMessageOk()]),
    });
    await expect(superviseur.demarrer(demande())).resolves.toBeDefined();
    await laisserPasserLesMicrotaches();
  });
});
