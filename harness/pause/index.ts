/**
 * Interface publique du module `pause` — pause et reprise d'un worker (branche B.4).
 * Aucun autre module ne doit importer les fichiers internes de ce dossier.
 */

export { CAPACITE_RECU_INTERRUPTION, ControleurPause, ControleurPauseError } from './controleur-pause.ts';
export type { OptionsControleurPause } from './controleur-pause.ts';

export { partitionnerStillQueued } from './partition.ts';

export type {
  EtatPause,
  FileEntreeCiblee,
  PartitionStillQueued,
  RecuInterruption,
  RegistrePauseAdapter,
  SourceInterruption,
} from './types.ts';

export { pauseLogger, pauseSessionLogger } from './logger.ts';
