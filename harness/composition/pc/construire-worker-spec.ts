/**
 * Responsabilité : construire un `WorkerSpec` (`workers/types.ts`) qui
 * n'omet JAMAIS `portBusPermissions` (H-73.1, H-74). Le type d'origine le
 * déclare optionnel — nécessairement, puisque `workers/` ne doit rien savoir
 * du bus de permissions (frontière de domaine) — mais rien n'empêchait un
 * appelant de composition de l'oublier. Cette fonction est le point unique où
 * un `WorkerSpec` de production devrait être construit : elle rend l'oubli
 * impossible en exigeant le port en paramètre, jamais en option.
 *
 * ☠ Aucun site de dispatch réel n'existe encore (H-61 : la création d'équipe
 * reste `differe`, en attente d'approbation humaine — voir mcp-controle). Ce
 * fichier est donc prêt à être appelé par ce futur site, pas encore appelé
 * lui-même en dehors du test d'assemblage.
 */

import type { WorkerSpec } from '../../workers/index.ts';
// `☠` Voir `composition/bus-permissions/port-colocalise.ts` : `PortBusPermissions`
// n'est pas exporté par `workers/index.ts`, import direct depuis `types.ts`.
import type { PortAuditPermissions, PortBusPermissions } from '../../workers/types.ts';

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
  portBusPermissions: PortBusPermissions,
  portAuditPermissions: PortAuditPermissions,
): WorkerSpec {
  // ☠ Les deux ports sont des paramètres OBLIGATOIRES, jamais des champs
  // optionnels de `parametres` (H-74) : un worker assemblé sans audit ni bus de
  // permissions passerait tous les tests en ne protégeant rien.
  return { ...parametres, portBusPermissions, portAuditPermissions };
}
