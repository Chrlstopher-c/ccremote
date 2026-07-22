/**
 * Interface publique du module « observabilite » — client temps réel
 * (branche E.2 + C.4.2 + F, mission M-50). Aucun autre module ne doit
 * importer les fichiers internes de ce dossier.
 */

export {
  RACINE_FLUX,
  type AbonnementObservation,
  type EvenementActiviteFil,
  type EvenementDiffuse,
  type EvenementFilMission,
  type EvenementPermissionFil,
  type Granularite,
  type LecteurSousAgents,
  type LigneTravailFlux,
  type ModeAbonnement,
  type NatureEvenementFil,
  type NoeudAgentProfond,
  type RapportCompletude,
  type ResumeEquipeObservee,
  type StatutLigne,
} from './types.ts';

export { ArbreFluxTempsReel, OUTIL_DELEGATION, type FragmentObserve } from './arbre-flux.ts';
export { evaluerCompletude } from './completude-sous-agents.ts';
export { chargerLigneAgent, listerSousAgentsConnus, ErreurLigneAgent } from './ligne-agent.ts';
export { evenementsPermissionsFil } from './permissions-fil.ts';
export { DiffusionObservation, CAPACITE_TAMPON_DEFAUT } from './diffusion-observation.ts';
export { RegistreObservationParc } from './registre-observation-parc.ts';
export { observabiliteLogger } from './logger.ts';
