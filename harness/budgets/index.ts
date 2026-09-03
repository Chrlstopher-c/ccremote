/**
 * Interface publique du module `budgets` — garde-fous de consommation (branche G,
 * mission M-51). Aucun autre module ne doit importer les fichiers internes de ce dossier.
 */

export { classifierMessageUsage, prefixesConnus } from './classification-usage.ts';
export { deciderActionUsage } from './politique-usage.ts';
export { deciderCreationMission } from './plafond-parc.ts';
export {
  RETRY_WATCHDOG_ENV,
  GardeBudgetError,
  assertRetryWatchdogCoherent,
  assertRetryWatchdogBorne,
  autoriserRetryWatchdog,
  autoriserTentativeRetryWatchdog,
  budgetEstActif,
  CompteurTentativesRetryWatchdog,
  PLAFOND_TENTATIVES_RETRY_WATCHDOG_DEFAUT,
} from './garde-retry-watchdog.ts';

export type { DecisionTentativeRetryWatchdog, EtatTentativesRetryWatchdog } from './garde-retry-watchdog.ts';

export type {
  CategorieMessageUsage,
  ClassificationMessageUsage,
  ConfigPlafondParc,
  DecisionPlafondParc,
  DecisionRetryWatchdog,
  DecisionUsage,
  EvenementQuotaObserve,
  ObservateurUsage,
  RelevePourPlafond,
  StatutQuotaObserve,
} from './types.ts';
