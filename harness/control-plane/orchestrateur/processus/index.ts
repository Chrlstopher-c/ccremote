/**
 * Interface publique du module « processus orchestrateur » (branche A.1, A.3.2,
 * A.4.2 — mission M-41). Aucun autre module ne doit importer les fichiers
 * internes de ce dossier.
 *
 * Périmètre : assembler LA session Agent SDK de l'orchestrateur maître — celle
 * avec qui Chris parle depuis l'app. Ce module ne réimplémente aucune branche
 * déléguée : [C] bus de permissions, [E] registre, [F] projets, [B] superviseur
 * de workers restent hors périmètre, invoqués via leurs interfaces publiques
 * déjà livrées (M-40, M-03, M-30, M-42).
 */

export {
  resoudreIdentite,
  type DecisionDemarrage,
  type ModeDemarrage,
  type StockageIdentite,
  type VerificateurSessionExistante,
} from './identite.ts';
export { StockageIdentiteFichier } from './identite.ts';

export { MANDAT_ORCHESTRATEUR } from './mandat.ts';

export {
  assertInvariantsOrchestrateur,
  composerOptionsOrchestrateur,
  MODELE_ORCHESTRATEUR,
  OptionsOrchestrateurError,
  OUTILS_INTERDITS_ORCHESTRATEUR,
  OUTILS_ORCHESTRATEUR,
} from './options-orchestrateur.ts';
export type { DependancesOptionsOrchestrateur } from './options-orchestrateur.ts';

export {
  creerHooksContexte,
  ingererMessageContexte,
  SourceContexteDifferee,
} from './contexte-integration.ts';

export {
  EntreeOrchestrateur,
  formaterMessageAttribue,
  type EmetteurEntreeOrchestrateur,
  type OptionsEntreeOrchestrateur,
} from './entree-orchestrateur.ts';

export {
  JournalIncidentsFichier,
  JournalIncidentsMemoire,
  type IncidentOrchestrateur,
  type JournalIncidentsOrchestrateur,
  type TypeIncidentOrchestrateur,
} from './incidents.ts';

export {
  construireAlarmeFermetureImprevue,
  PLAFOND_REDEMARRAGES_AUTOMATIQUES,
  type DependancesAlarmeFermeture,
} from './alarme-fermeture-imprevue.ts';

export {
  demarrerOrchestrateur,
  DemarrageOrchestrateurError,
  type DemarrerChaudFn,
  type DependancesDemarrageOrchestrateur,
  type PoigneeOrchestrateur,
} from './demarrage.ts';

export { processusOrchestrateurLogger } from './logger.ts';
