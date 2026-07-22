/**
 * Interface publique du module `superviseur` — canal de contrôle et superviseur de
 * workers du PC (branche B / D.3, mission M-13). Aucun autre module ne doit
 * importer les fichiers internes de ce dossier.
 */

export type { DemandeDemarrage, EnregistrementWorker, ObservateurRelance } from './types.ts';

export { RegistreWorkers } from './registre-workers.ts';

export {
  SuperviseurError,
  SuperviseurWorkers,
  type DemarrerWorkerFn,
  type DependancesSuperviseur,
} from './superviseur-workers.ts';

export { extraireDemandesEnAttente } from './reponse-reinitialize.ts';

export {
  CanalControle,
  type EffetControle,
  type OperationControle,
  type OptionsCanalControle,
  type PortSuperviseurControle,
  type ReponseControle,
  type RequeteControle,
} from './canal-controle.ts';

export { missionLogger, superviseurLogger } from './logger.ts';
