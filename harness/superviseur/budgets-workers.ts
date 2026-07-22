/**
 * Responsabilité : observation des quotas et messages d'usage (mission M-51,
 * H-54/H-63/G.1.4). Extrait MÉCANIQUEMENT de `superviseur-workers.ts` (dette n°4a,
 * TODO.md) pour respecter la limite de 500 lignes — aucun changement de
 * comportement, aucun renommage.
 */

import { classifierMessageUsage, deciderActionUsage } from '../budgets/index.ts';
import type { EvenementQuotaObserve, ObservateurUsage } from '../budgets/index.ts';
import { missionLogger } from './logger.ts';

/**
 * Relaie un `rate_limit_event` brut (H-54/H-63, mission M-51). Best-effort,
 * jamais bloquant : la persistance (registre du Pi) et l'agrégation par compte
 * sont hors périmètre de ce module (frontière A↔B).
 */
export function surveillerQuota(
  observateurUsage: ObservateurUsage | undefined,
  missionId: string,
  sessionId: string,
  info: { status: string; rateLimitType?: string; utilization?: number; resetsAt?: number },
): void {
  const evenement: EvenementQuotaObserve = {
    missionId,
    sessionId,
    statut: info.status as EvenementQuotaObserve['statut'],
    rateLimitType: info.rateLimitType ?? null,
    utilisation: info.utilization ?? null,
    resetsAt: info.resetsAt ?? null,
  };
  missionLogger(missionId).info({ evenement }, 'rate_limit_event observé (H-54/H-63)');
  try {
    observateurUsage?.surQuota?.(evenement);
  } catch (erreur) {
    missionLogger(missionId).error({ err: erreur }, "l'observateur de quota a levé — ignoré, jamais bloquant");
  }
}

/**
 * Classifie une bannière `system` (G.1.4, panne #16, mission M-51) et relaie la
 * décision. `☠` Ne fait AUCUN effet lui-même (pas de suspension réelle des
 * créations ici) — ce module ignore le registre (frontière A↔B) ; il ne fait que
 * rendre le signal observable.
 */
export function surveillerMessageUsage(observateurUsage: ObservateurUsage | undefined, missionId: string, texte: string): void {
  const classification = classifierMessageUsage(texte);
  if (classification.categorie === 'aucune') return;
  const decision = deciderActionUsage(classification);
  missionLogger(missionId).info(
    { categorie: decision.classification.categorie, suspendreCreations: decision.suspendreCreations, notifier: decision.notifier },
    'message d’usage classifié (G.1.4)',
  );
  try {
    observateurUsage?.surMessageUsage?.(missionId, decision);
  } catch (erreur) {
    missionLogger(missionId).error({ err: erreur }, "l'observateur de message d'usage a levé — ignoré, jamais bloquant");
  }
}
