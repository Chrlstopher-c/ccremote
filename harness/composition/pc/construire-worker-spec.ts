/**
 * Responsabilité : construire un `WorkerSpec` (`workers/types.ts`) qui n'omet
 * JAMAIS le port d'audit (H-74). Le type d'origine ne peut pas l'imposer seul —
 * `workers/` ne doit rien savoir de `control-plane/` (frontière de domaine) —
 * mais rien n'empêchait un appelant de composition de l'oublier. Cette fonction
 * est le point unique où un `WorkerSpec` de production est construit : elle rend
 * l'oubli impossible en exigeant le port en paramètre, jamais en option.
 */

import type { WorkerSpec } from '../../workers/index.ts';
import type { PortAuditPermissions } from '../../workers/types.ts';

export interface ParametresWorkerSpec {
  readonly sessionId: string;
  readonly cwd: string;
  readonly mandate: string;
  readonly deniedToolPatterns: readonly string[];
  readonly maxBudgetUsd: number;
  readonly model?: string;
  readonly effortLevel?: 'low' | 'medium' | 'high' | 'xhigh';
  readonly configDir?: string;
  readonly agentTeams?: boolean;
  readonly extraEnv?: Readonly<Record<string, string>>;
}

export function construireWorkerSpec(
  parametres: ParametresWorkerSpec,
  portAuditPermissions: PortAuditPermissions,
): WorkerSpec {
  // ☠ Le port d'audit est un paramètre OBLIGATOIRE, jamais un champ optionnel
  // de `parametres` (H-74) : un worker assemblé sans audit passerait tous les
  // tests en n'observant rien.
  return { ...parametres, portAuditPermissions };
}
