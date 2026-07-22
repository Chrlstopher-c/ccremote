/**
 * Responsabilité : empêcher `CLAUDE_CODE_RETRY_WATCHDOG=1` sans budget actif (G.1.4,
 * acceptation (d), panne #15, mission M-51).
 *
 * `maxBudgetUsd` reste, après H-68, un filet de dernier recours et non l'anti-boucle —
 * mais tant qu'il est fini et strictement positif, il BORNE quelque chose. Sans lui,
 * `CLAUDE_CODE_RETRY_WATCHDOG=1` retente les erreurs de capacité indéfiniment (G.1.4) :
 * sur abonnement, ce n'est pas une dépense non bornée (H-58) mais une **consommation de
 * quota non bornée**, qui peut saturer le compte pendant la nuit. Les deux vont ensemble
 * ou aucun.
 */

export const RETRY_WATCHDOG_ENV = 'CLAUDE_CODE_RETRY_WATCHDOG';

export class GardeBudgetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GardeBudgetError';
  }
}

/** `true` seulement si le budget borne réellement quelque chose (fini, strictement positif). */
export function budgetEstActif(maxBudgetUsd: number | null | undefined): boolean {
  return typeof maxBudgetUsd === 'number' && Number.isFinite(maxBudgetUsd) && maxBudgetUsd > 0;
}

export function autoriserRetryWatchdog(maxBudgetUsd: number | null | undefined): {
  readonly autorise: boolean;
  readonly motif: string;
} {
  if (budgetEstActif(maxBudgetUsd)) {
    return {
      autorise: true,
      motif: 'budget actif (maxBudgetUsd fini et strictement positif) — retry watchdog borné (G.1.4)',
    };
  }
  return {
    autorise: false,
    motif:
      'aucun budget actif — activer CLAUDE_CODE_RETRY_WATCHDOG serait une consommation de quota non bornée ' +
      '(panne #15, acceptation d)',
  };
}

/**
 * `☠ CASSE` (panne #15) — point d'application réel : lève si l'environnement composé
 * pose `CLAUDE_CODE_RETRY_WATCHDOG=1` sans qu'un budget actif l'accompagne. À appeler à
 * chaque composition d'environnement de worker, jamais seulement documenté.
 */
export function assertRetryWatchdogCoherent(
  env: Readonly<Record<string, string | undefined>>,
  maxBudgetUsd: number | null | undefined,
): void {
  if (env[RETRY_WATCHDOG_ENV] !== '1') return;
  const decision = autoriserRetryWatchdog(maxBudgetUsd);
  if (!decision.autorise) {
    throw new GardeBudgetError(`${RETRY_WATCHDOG_ENV}=1 refusé : ${decision.motif}`);
  }
}
