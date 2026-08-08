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
