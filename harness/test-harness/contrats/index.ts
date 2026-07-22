// Interface publique de la couche contrats du harness de test.
// Les missions ultérieures implémentent ces interfaces côté production ;
// le harness en fournit des doublures déterministes.

export type { Alea, AnnulerMinuterie, Horloge } from './horloge.ts';
export type {
  CodeFermeture,
  EtatLien,
  FermetureTerminale,
  Lien,
  ModeIntegrite,
  ProcessusDistant,
  Tuyau,
} from './transport.ts';
export { ErreurIntegriteTuyau } from './transport.ts';
export type {
  DemandeSpawn,
  DescripteurWorker,
  IdWorker,
  SuperviseurWorkers,
} from './superviseur.ts';
export type {
  BusPermissions,
  DemandePermission,
  EntreeDemande,
  EtatDemande,
  Verdict,
} from './permissions.ts';
export type {
  EntreeSession,
  MessageMiroirErreur,
  StoreObservable,
  StoreSessions,
} from './session-store.ts';
export { REESSAIS_SUR_REJET, TIMEOUT_STORE_MS } from './session-store.ts';
export type { DiffusionObservation, EvenementObservation } from './diffusion.ts';
