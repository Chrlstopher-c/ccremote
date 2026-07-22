/**
 * Interface publique du module `projets` (branche F : F.1, F.2, F.4).
 * Aucun autre module ne doit importer les fichiers internes de ce dossier.
 */

export type {
  ConfigProjet,
  ConfigProjetBrute,
  CodeEchecValidationProjet,
  EchecValidationProjet,
  EtatRevendicationWorktree,
  IdEquipe,
  IdProjet,
  ProjetRejete,
  ResultatChargementProjets,
  RevendicationWorktree,
} from './types.ts';

export {
  SEUIL_ALERTE_MOTIFS_SUPPLEMENTAIRES_PROJET,
  validerConfigProjet,
} from './validation-config.ts';
export type { DependancesValidation, ResultatValidationProjet } from './validation-config.ts';

export { chargerProjets } from './chargeur-projets.ts';
export type { DependancesChargeur } from './chargeur-projets.ts';

export {
  AucuneRevendicationActiveError,
  EpochNonCroissantError,
  GestionnaireCycleVieWorktree,
  WorktreeDejaRevendiqueeError,
} from './cycle-vie-worktree.ts';
export type { DependancesCycleVieWorktree, ParametresAllocation } from './cycle-vie-worktree.ts';

export type { GestionnaireWorktreeGit, InterrogateurGit } from './git-projet.ts';
export {
  InterrogateurGitReel,
  GestionnaireWorktreeGitReel,
  construireCommandeCommitsEnAttente,
  construireCommandeCreerWorktree,
  construireCommandeEstDepotGit,
  construireCommandeExisteBranche,
  construireCommandeStatutPorcelain,
  construireCommandeSupprimerWorktree,
} from './git-projet.ts';

export { equipeLogger, projetLogger, projetsLogger } from './logger.ts';
