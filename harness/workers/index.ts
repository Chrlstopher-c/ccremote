/**
 * Interface publique du module `workers` — superviseur de workers, côté PC (branche B).
 * Aucun autre module ne doit importer les fichiers internes de ce dossier.
 */

export type {
  ModelTier,
  PortAuditPermissions,
  PreflightFailure,
  PreflightFailureCode,
  PreflightReport,
  QueryFn,
  ResolvedModel,
  WorkerCapabilities,
  WorkerHandle,
  WorkerSpec,
} from './types.ts';

export {
  MODEL_FLOOR,
  ModelFloorError,
  ModelResolutionError,
  assertModelFloor,
  classifyModel,
  resolveModel,
  resolveModelWithFloor,
} from './model-floor.ts';

export {
  DEFAULT_SETTING_SOURCES,
  findProjectClaudeMd,
  machineClaudeMdPath,
  runPreflight,
} from './preflight-config.ts';
export type { PreflightInput } from './preflight-config.ts';

export {
  AGENT_TEAMS_ENV,
  CONFIG_DIR_ENV,
  OptionsCompositionError,
  assertOptionsInvariants,
  buildWorkerEnv,
  composeWorkerOptions,
} from './options-composition.ts';
export type { ComposedWorkerOptions, ModeIdentiteSession } from './options-composition.ts';

export { WorkerStartError, hasCapability, readCapabilities, startWorker } from './start-worker.ts';
export type { StartWorkerDeps } from './start-worker.ts';

export { buildAuditHooks } from './audit-hooks.ts';

export { creerSpawnerLocal, lireStarttimeAuSpawn } from './process-spawner.ts';
export type { IdentiteProcessSpawn } from './process-spawner.ts';

export { sessionLogger, workerLogger } from './logger.ts';
