/**
 * Interface publique du domaine `apprentissage` — le seul import autorisé de
 * l'extérieur (SPEC-APPRENTISSAGE.md, PLAN-PORTAGE.md « règles valables pour toutes
 * les étapes »). Aucun autre module ne doit importer les fichiers internes de ce
 * dossier.
 *
 * Conception inspirée de Hermes Agent (Nous Research) — MIT. Transposition indépendante en TypeScript.
 */

export {
  cheminBaseParDefaut,
  fermerBaseApprentissage,
  ouvrirBaseApprentissage,
} from './base/connexion.ts';
export type { OptionsConnexionApprentissage } from './base/connexion.ts';

export { migrer, versionSchema, VERSION_SCHEMA_CIBLE } from './base/migrations.ts';
export type { Migration } from './base/migrations.ts';

export {
  creerLecon,
  enregistrerObservation,
  enregistrerPasse,
  estMissionTraitee,
  listerLeconsParProjet,
  obtenirLecon,
  obtenirPasse,
} from './base/lecons.ts';

export { estimerTokensResumeMission, reduireTranscript } from './observation/reduction-transcript.ts';
export type { ParametresReduction } from './observation/reduction-transcript.ts';

export { classerIssue } from './observation/classement-issue.ts';
export type {
  ConstatGitMission,
  DonneesMissionTerminee,
  EtatHarnessMission,
  VerdictInspectionMission,
} from './observation/classement-issue.ts';

export { creerClientInference, MODELE_APPRENTISSAGE_PAR_DEFAUT } from './extraction/client-inference.ts';
export type {
  ClientInference,
  DependancesClientInference,
  ParametresAppelModele,
  ReponseModele,
} from './extraction/client-inference.ts';

export {
  validerLeconExtraite,
  validerLeconsExtraites,
  validerOperationCompetence,
  validerVerdictRapprochement,
} from './extraction/garde-sortie.ts';
export type { LeconExtraite, ResultatGarde, RelationRapprochement, VerdictRapprochement } from './extraction/garde-sortie.ts';

export { construirePromptExtraction, LISTE_NEGATIVE_LECONS } from './extraction/prompts.ts';

export { extraireLecons, respecteListeNegative } from './extraction/extraction-lecons.ts';
export type { ResultatExtraction } from './extraction/extraction-lecons.ts';

export { rapprocherLecons } from './extraction/rapprochement.ts';
export type { ActionRapprochement, ParametresRapprochement, ResultatRapprochementUnitaire } from './extraction/rapprochement.ts';

export {
  confirmerLecon,
  contredireLecon,
  listerLeconsServables,
  listerToutesLecons,
  transitionnerEtatLecon,
} from './base/lecons.ts';
export type { ResultatConfirmation, ResultatContradiction } from './base/lecons.ts';

export { enregistrerDernierePasseA, obtenirDernierePasseA } from './base/horloge-consolidation.ts';

export { enfilerPasseApprentissage } from './service/file-attente.ts';
export type { DependancesFileAttente } from './service/file-attente.ts';

export { executerPasseCloture } from './service/passe-cloture.ts';
export type { EntreePasseCloture, ResultatPasseCloture } from './service/passe-cloture.ts';

export { composerBlocLecons } from './injection/bloc-lecons.ts';

export {
  changerEtatCompetence,
  cheminCompetencesParDefaut,
  lireCompetence,
  listerCompetences,
  listerCompetencesServables,
  listerSlugsCompetences,
  slugifier,
} from './competences/depot-competences.ts';
export type { CorpsCompetence, FichierCompetence } from './competences/depot-competences.ts';

export { appliquerOperationCompetence, SEUIL_LECONS_CREATION, SEUIL_LECONS_PIEGE } from './competences/operations.ts';
export type { ContexteOperationCompetence, ResultatOperationCompetence } from './competences/operations.ts';

export {
  cheminApprentissageParDefaut,
  cheminSauvegardesParDefaut,
  listerSauvegardes,
  MAX_SAUVEGARDES_CONSERVEES,
  sauvegarderAvantPasse,
} from './service/sauvegarde.ts';
export type { ParametresSauvegarde, ResultatSauvegarde } from './service/sauvegarde.ts';

export {
  DELAI_DORMANCE_MS,
  executerConsolidation,
  INTERVALLE_MIN_MS,
} from './service/consolidation.ts';
export type { EntreeConsolidation, ResultatConsolidation, TransitionsAppliquees } from './service/consolidation.ts';

export type {
  CategorieLecon,
  Competence,
  CreationLecon,
  EtatCompetence,
  EtatLecon,
  Lecon,
  LeconObservation,
  IssueMission,
  OperationCompetence,
  PasseApprentissage,
  Portee,
  ResumeMission,
  SensObservation,
  SousAgentResume,
  UsageOutil,
} from './types.ts';
