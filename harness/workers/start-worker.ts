/**
 * Responsabilité : exécuter la séquence de démarrage d'un worker (B.1.2).
 *
 * Ordre imposé, chaque étape bloquante pour la suivante. `☠ CASSE` — sauter le
 * pré-vol (1) ou la lecture des capacités (6) produit des pannes qui ne se
 * manifestent que des heures plus tard, en comportement dégradé sans erreur.
 */

import { query as sdkQuery } from '@anthropic-ai/claude-agent-sdk';
import type { Query, SDKMessage, SDKSystemMessage, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { composeWorkerOptions } from './options-composition.ts';
import { sessionLogger } from './logger.ts';
import { resolveModelWithFloor } from './model-floor.ts';
import { runPreflight } from './preflight-config.ts';
import { creerSpawnerLocal, type IdentiteProcessSpawn } from './process-spawner.ts';
import type { PreflightReport, QueryFn, WorkerCapabilities, WorkerHandle, WorkerSpec } from './types.ts';

/** Au-delà, on considère que le binaire ne parlera pas. */
const DEFAULT_INIT_TIMEOUT_MS = 60_000;
/** Garde-fou : le message `init` arrive en tête ; au-delà c'est anormal. */
const MAX_MESSAGES_BEFORE_INIT = 50;

export class WorkerStartError extends Error {
  constructor(
    message: string,
    readonly stage: 'preflight' | 'worktree' | 'model' | 'spawn' | 'init',
    readonly preflight?: PreflightReport,
  ) {
    super(message);
    this.name = 'WorkerStartError';
  }
}

export interface StartWorkerDeps {
  /** Injectable pour les tests : jamais de spawn réel en unitaire. */
  readonly query?: QueryFn;
  readonly preflight?: typeof runPreflight;
  /** Étape 2, déléguée à F.2. Absente ⇒ étape signalée comme non vérifiée. */
  readonly verifyWorktree?: (cwd: string) => Promise<void>;
  readonly initTimeoutMs?: number;
  /**
   * `true` ⇒ compose les options en mode reprise (`resume: spec.sessionId`)
   * plutôt qu'en spawn neuf (`sessionId: spec.sessionId`). Sert la relance
   * (B.3.3, superviseur/) : même séquence de démarrage, identité différente.
   */
  readonly resume?: boolean;
}

function isInitMessage(message: SDKMessage): message is SDKSystemMessage {
  return message.type === 'system' && message.subtype === 'init';
}

/**
 * Étape 6 — les capacités sont **lues** dans `SDKSystemMessage.capabilities`.
 * `☠` Ne jamais les déduire de `claude_code_version` : c'est ainsi qu'on finit
 * par s'appuyer sur une API disparue (panne #37).
 */
export function readCapabilities(init: SDKSystemMessage): WorkerCapabilities {
  return {
    advertised: [...(init.capabilities ?? [])],
    claudeCodeVersion: init.claude_code_version,
    tools: [...init.tools],
    model: init.model,
    sessionId: init.session_id,
  };
}

/** Feature-detection : le seul test légitime d'une capacité. */
export function hasCapability(capabilities: WorkerCapabilities, name: string): boolean {
  return capabilities.advertised.includes(name);
}

async function pullInitMessage(stream: Query, timeoutMs: number): Promise<SDKSystemMessage> {
  const deadline = Date.now() + timeoutMs;
  for (let pulled = 0; pulled < MAX_MESSAGES_BEFORE_INIT; pulled += 1) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    const next = await Promise.race([
      stream.next(),
      new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), remaining)),
    ]);
    if (next === 'timeout') break;
    if (next.done === true) {
      throw new WorkerStartError('flux terminé avant le message init', 'init');
    }
    if (isInitMessage(next.value)) return next.value;
  }
  throw new WorkerStartError(
    `aucun message init reçu (timeout ${timeoutMs} ms ou ${MAX_MESSAGES_BEFORE_INIT} messages)`,
    'init',
  );
}

async function preflightStage(spec: WorkerSpec, deps: StartWorkerDeps): Promise<PreflightReport> {
  const run = deps.preflight ?? runPreflight;
  const report = await run({ cwd: spec.cwd, configDir: spec.configDir });
  if (!report.ok) {
    const codes = report.failures.map((failure) => failure.code).join(', ');
    throw new WorkerStartError(`pré-vol config en échec : ${codes}`, 'preflight', report);
  }
  return report;
}

async function worktreeStage(spec: WorkerSpec, deps: StartWorkerDeps): Promise<void> {
  const log = sessionLogger(spec.sessionId);
  if (deps.verifyWorktree === undefined) {
    log.warn({ cwd: spec.cwd }, 'worktree non vérifié : aucun vérificateur fourni (F.2)');
    return;
  }
  try {
    await deps.verifyWorktree(spec.cwd);
  } catch (error) {
    throw new WorkerStartError(`vérification du worktree échouée : ${String(error)}`, 'worktree');
  }
}

/**
 * Démarre un worker et rend une poignée annonçable au Pi (étape 7).
 * `prompt` appartient à l'appelant : un générateur d'entrée fermé pendant que
 * Claude travaille coupe `canUseTool` et les hooks sans autre trace que stderr.
 */
export async function startWorker(
  spec: WorkerSpec,
  prompt: string | AsyncIterable<SDKUserMessage>,
  deps: StartWorkerDeps = {},
): Promise<WorkerHandle> {
  const log = sessionLogger(spec.sessionId);
  const preflight = await preflightStage(spec, deps);
  await worktreeStage(spec, deps);
  const model = resolveModelWithFloor(spec.model, preflight.effectiveModel);

  // ☠ H-74 : sans capture ici, WorkerHandle.pid/pidStarttime ne sont jamais
  // alimentés et restaurerRegistre() reste condamné à `indetermine` pour
  // toujours (voir process-spawner.ts). Si l'appelant fournit déjà son propre
  // spawnProcess (spawn distant, B.2.1), on ne le remplace pas — pas de pid
  // local à capturer dans ce cas, pid/pidStarttime resteront `null` (explicite).
  // Boîte mutable plutôt qu'un `let` réassigné dans la closure du spawner :
  // TS ne suit pas la réassignation à travers l'appel de callback et narrowe
  // sinon la variable à `null` au point de lecture, plus bas dans la fonction.
  const identiteRef: { courante: IdentiteProcessSpawn | null } = { courante: null };
  const specPourSpawn: WorkerSpec =
    spec.spawnProcess !== undefined
      ? spec
      : {
          ...spec,
          spawnProcess: creerSpawnerLocal((identite) => {
            identiteRef.courante = identite;
          }),
        };

  const { options, abortController } = composeWorkerOptions(specPourSpawn, model, deps.resume === true ? 'reprise' : 'nouvelle');

  let stream: Query;
  try {
    stream = (deps.query ?? sdkQuery)({ prompt, options });
  } catch (error) {
    throw new WorkerStartError(`spawn impossible : ${String(error)}`, 'spawn', preflight);
  }

  const init = await pullInitMessage(stream, deps.initTimeoutMs ?? DEFAULT_INIT_TIMEOUT_MS);
  const capabilities = readCapabilities(init);
  log.info(
    { capabilities, model, pid: identiteRef.courante?.pid ?? null },
    'worker démarré, capacités lues depuis init',
  );
  return {
    sessionId: spec.sessionId,
    cwd: spec.cwd,
    capabilities,
    model,
    preflight,
    abortController,
    query: stream,
    pid: identiteRef.courante?.pid ?? null,
    pidStarttime: identiteRef.courante?.pidStarttime ?? null,
  };
}
