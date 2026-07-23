/**
 * Interface publique du module `superviseur` — canal de contrôle et superviseur de
 * workers du PC (branche B / D.3, mission M-13). Aucun autre module ne doit
 * importer les fichiers internes de ce dossier.
 */

export type {
  ConcurrentRestaure,
  DemandeDemarrage,
  DemandeDemarrageTransportable,
  ParametresSpecTransportables,
  EnregistrementWorker,
  EtapeArretUrgence,
  EtatRevalidationProcess,
  LigneRegistrePersistee,
  ObservateurFlux,
  ObservateurRelance,
  ObservateurUsage,
  RapportArretUrgence,
  ResultatArretUnitaireUrgence,
} from './types.ts';

export { RegistreWorkers } from './registre-workers.ts';

export {
  PersistanceRegistreSqlite,
  type EnregistrementAPersister,
  type OptionsPersistanceRegistre,
  type PersistanceRegistre,
} from './persistance-registre.ts';

export { lireStarttimeProc, revaliderProcess, type LecteurStarttime } from './revalidation-process.ts';

export { restaurerRegistre, type DependancesRestauration } from './restauration-registre.ts';

export {
  GRACE_ARRET_URGENCE_MS_DEFAUT,
  SuperviseurError,
  SuperviseurWorkers,
  type DemarrerWorkerFn,
  type DependancesSuperviseur,
} from './superviseur-workers.ts';

export { extraireDemandesEnAttente } from './reponse-reinitialize.ts';

export {
  CablageAntiBoucle,
  type ConfigAntiBoucle,
  type DependancesCablageAntiBoucle,
  type ObservateurAntiBoucle,
} from './anti-boucle-workers.ts';

export {
  arbitrerFencing,
  type DecisionFencing,
  type DetenteurEpoch,
  type MotifRejetFencing,
} from './fencing-epoch.ts';

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
