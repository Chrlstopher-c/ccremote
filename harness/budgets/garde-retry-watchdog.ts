/**
 * Responsabilité : empêcher `CLAUDE_CODE_RETRY_WATCHDOG=1` sans budget actif (G.1.4,
 * acceptation (d), panne #15, mission M-51) ET borner le nombre de fois où ce module
 * accepte de le réarmer pour une même session (C1, PLAN-OPTIMISATION-QUOTAS.md, cause 5).
 *
 * `maxBudgetUsd` reste, après H-68, un filet de dernier recours et non l'anti-boucle —
 * mais tant qu'il est fini et strictement positif, il BORNE quelque chose. Sans lui,
 * `CLAUDE_CODE_RETRY_WATCHDOG=1` retente les erreurs de capacité indéfiniment (G.1.4) :
 * sur abonnement, ce n'est pas une dépense non bornée (H-58) mais une **consommation de
 * quota non bornée**, qui peut saturer le compte pendant la nuit. Les deux vont ensemble
 * ou aucun.
 *
 * `☠` LIMITE CONNUE (C1, 2026-09-03) : le CLI embarqué ne publie aucun hook ni variable
 * d'environnement qui compterait les tentatives RÉELLEMENT faites par
 * `CLAUDE_CODE_RETRY_WATCHDOG` À L'INTÉRIEUR d'un process déjà démarré — c'est un
 * mécanisme opaque au SDK (vérifié sur `sdk.mjs` du SDK embarqué, aucune trace d'un
 * compteur ou d'un plafond configurable). Le budget en dollars restait donc jusqu'ici la
 * SEULE borne observable, et 250 $ par défaut est trop lâche (audit qualité, cause 5).
 *
 * Le point d'observation réel dont dispose le harness est celui déjà instrumenté ailleurs
 * (`relance/politique-relance.ts`, `superviseur/superviseur-workers.ts`) : CHAQUE fois
 * qu'une session est (re)démarrée sous ce nom de session — via un `resume` après crash ou
 * un nouveau dispatch qui réutilise l'identité — c'est un nouveau point où
 * `buildWorkerEnv` compose l'environnement et pourrait réarmer le watchdog.
 * `CompteurTentativesRetryWatchdog` borne CE point-là : au plafond, la composition refuse
 * de réarmer `CLAUDE_CODE_RETRY_WATCHDOG=1` même avec un budget actif — max N
 * (re)démarrages protégés par le watchdog pour une même session, avec un délai de recul
 * (`delaiBackoffMs`, même primitive que B.3.1) entre deux réarmements. Ça complète
 * `assertRetryWatchdogCoherent`, qui reste la garde de première ligne (H-68) — cette
 * borne-ci ne la remplace jamais.
 */

import { delaiBackoffMs } from '../relance/backoff.ts';

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

/** Plafond par défaut de réarmements du watchdog pour une même session (C1). */
export const PLAFOND_TENTATIVES_RETRY_WATCHDOG_DEFAUT = 5;

export interface EtatTentativesRetryWatchdog {
  readonly sessionId: string;
  readonly tentativesEffectuees: number;
  readonly plafond: number;
}

/**
 * Compteur de réarmements du retry watchdog PAR SESSION (C1, même patron que
 * `relance/compteur-relances.ts::CompteurRelances`, jamais partagé entre sessions — H-11).
 * `☠` Ne compte QUE les réarmements que ce module a lui-même AUTORISÉS
 * (`enregistrerTentative`) : un refus (plafond déjà atteint, ou budget inactif) n'en est
 * pas un.
 */
export class CompteurTentativesRetryWatchdog {
  readonly #etats = new Map<string, EtatTentativesRetryWatchdog>();

  constructor(private readonly plafondDefaut: number = PLAFOND_TENTATIVES_RETRY_WATCHDOG_DEFAUT) {}

  etat(sessionId: string, plafond?: number): EtatTentativesRetryWatchdog {
    const existant = this.#etats.get(sessionId);
    if (existant !== undefined) return existant;
    const initial: EtatTentativesRetryWatchdog = {
      sessionId,
      tentativesEffectuees: 0,
      plafond: plafond ?? this.plafondDefaut,
    };
    this.#etats.set(sessionId, initial);
    return initial;
  }

  sousLePlafond(sessionId: string): boolean {
    const etat = this.etat(sessionId);
    return etat.tentativesEffectuees < etat.plafond;
  }

  enregistrerTentative(sessionId: string): EtatTentativesRetryWatchdog {
    const precedent = this.etat(sessionId);
    const suivant: EtatTentativesRetryWatchdog = { ...precedent, tentativesEffectuees: precedent.tentativesEffectuees + 1 };
    this.#etats.set(sessionId, suivant);
    return suivant;
  }

  /** Remise à zéro explicite — par ex. après un tour honoré sans capacité error (session saine). */
  reinitialiser(sessionId: string): void {
    this.#etats.delete(sessionId);
  }
}

export interface DecisionTentativeRetryWatchdog {
  readonly autorise: boolean;
  readonly motif: string;
  /** Délai de recul à respecter avant le PROCHAIN réarmement (B.3.1), même si celui-ci est autorisé. */
  readonly delaiAvantProchaineMs: number;
}

/**
 * Décide si un nouveau réarmement du watchdog est autorisé pour `sessionId`, et
 * enregistre la tentative si oui. `☠ CASSE` (C1) — point d'application réel, à appeler à
 * CHAQUE composition d'environnement de worker qui réutiliserait le watchdog pour une
 * session déjà vue (resume après crash, relance), en complément — jamais en remplacement —
 * d'`assertRetryWatchdogCoherent`.
 */
export function autoriserTentativeRetryWatchdog(
  sessionId: string,
  compteur: CompteurTentativesRetryWatchdog,
): DecisionTentativeRetryWatchdog {
  const avant = compteur.etat(sessionId);
  if (!compteur.sousLePlafond(sessionId)) {
    return {
      autorise: false,
      motif: `plafond de réarmements du retry watchdog atteint (${avant.tentativesEffectuees}/${avant.plafond}) — ` +
        'relance infinie sur capacité refusée (C1)',
      delaiAvantProchaineMs: delaiBackoffMs(avant.tentativesEffectuees > 0 ? avant.tentativesEffectuees : 1),
    };
  }
  const apres = compteur.enregistrerTentative(sessionId);
  return {
    autorise: true,
    motif: `réarmement ${apres.tentativesEffectuees}/${apres.plafond} du retry watchdog accordé`,
    delaiAvantProchaineMs: delaiBackoffMs(apres.tentativesEffectuees),
  };
}

/**
 * Garde complète : budget actif (H-68) ET sous le plafond de tentatives (C1). Lève
 * `GardeBudgetError` dans les deux cas de refus — un appelant qui composerait
 * l'environnement d'un worker doit pouvoir traiter les deux la même façon (refus AVANT
 * toute écriture, code-standards).
 */
export function assertRetryWatchdogBorne(
  env: Readonly<Record<string, string | undefined>>,
  maxBudgetUsd: number | null | undefined,
  sessionId: string,
  compteur: CompteurTentativesRetryWatchdog,
): void {
  assertRetryWatchdogCoherent(env, maxBudgetUsd);
  if (env[RETRY_WATCHDOG_ENV] !== '1') return;
  const decision = autoriserTentativeRetryWatchdog(sessionId, compteur);
  if (!decision.autorise) {
    throw new GardeBudgetError(`${RETRY_WATCHDOG_ENV}=1 refusé pour la session « ${sessionId} » : ${decision.motif}`);
  }
}
