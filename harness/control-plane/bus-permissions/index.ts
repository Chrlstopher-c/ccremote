/**
 * Interface publique du module « bus-permissions » (branche C.2/C.3, mission
 * M-21). Aucun autre module ne doit importer les fichiers internes de ce dossier.
 *
 * Périmètre : la machine à états (C.2.1, C.2.2, C.3.2, C.3.3). Le canal
 * hors-bande (C.2.3) et la trace d'audit / l'arbitrage délégué (C.5) sont
 * hors de ce module (M-23, M-22).
 */

export { MachineEtatsDemandes } from './machine-etats.ts';
export type {
  DemandePermission,
  EntreeDemande,
  EtatDemande,
  HorlogeBus,
  ResultatRedelivrance,
  Verdict,
} from './types.ts';
export { HORLOGE_REELLE_BUS } from './types.ts';
export { busPermissionsLogger } from './logger.ts';
