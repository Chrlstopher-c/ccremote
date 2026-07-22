/**
 * Interface publique du module `plancher-deni` (branche C.1.3 / G.2).
 * Aucun autre module ne doit importer les fichiers internes de ce dossier.
 */

export type { MotifDeni, OutilCible } from './types.ts';
export { formatterRegleSdk } from './types.ts';

export { MAX_MOTIFS_PLANCHER, PLANCHER_DENI, PLANCHER_DENI_SDK } from './motifs.ts';

export {
  MotifNonScopeError,
  PlancherTropLargeError,
  assertIdsUniques,
  assertMotifsScopes,
  assertPlancherBorne,
  validerPlancher,
} from './validation.ts';

export type { AppelOutil, ModePermission, VerdictSimule } from './simulateur-arbitrage.ts';
export { simulerArbitrage } from './simulateur-arbitrage.ts';
