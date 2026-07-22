/**
 * Interface publique du module « réconciliation » (E.1.4, A.4.2, D.2.4, mission M-30).
 * Aucun autre module ne doit importer les fichiers internes de ce dossier.
 *
 * Périmètre : réconcilier le registre (Pi) et l'inventaire réel du PC au démarrage, à la
 * reconnexion, ou périodiquement. Le superviseur réel (branche B) et la matérialisation
 * réelle de `Query.reinitialize()` sont hors périmètre — ce module ne dépend que de ports.
 */

export { reconcilier, type OptionsReconciliation } from './reconciliation.ts';
export type {
  DeclencheurReconciliation,
  DependancesReconciliation,
  DescripteurWorkerPc,
  DemandeEnAttenteReinitialisation,
  InventairePc,
  LibererWorktree,
  RapportReconciliation,
  RedelivranceBusPermissions,
  ReinitialisateurSession,
  RemiseAZeroRelances,
  ResultatReinitialisation,
} from './types.ts';
