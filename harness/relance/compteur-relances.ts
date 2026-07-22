/**
 * Responsabilité : compteur de relances par équipe, avec plafond (B.3.3).
 *
 * « Compteur de relances par équipe, avec plafond. Au plafond : état `echec_definitif`,
 * notification, pas de nouvelle tentative. » — un compteur par `sessionId`, jamais partagé
 * entre équipes (H-11 : une équipe = une session = un worktree, l'isolation des pannes est
 * gratuite, elle doit rester vraie ici aussi).
 */

import type { EtatCompteurRelance } from './types.ts';

/** Plafond par défaut si l'appelant n'en fixe pas. Généreux : le vrai bornage est G.1/H-68. */
export const PLAFOND_RELANCES_DEFAUT = 5;

export class CompteurRelances {
  readonly #etats = new Map<string, EtatCompteurRelance>();

  constructor(private readonly plafondDefaut: number = PLAFOND_RELANCES_DEFAUT) {}

  /** Lit l'état courant, l'initialise à zéro tentative si l'équipe est inconnue. */
  etat(sessionId: string, plafond?: number): EtatCompteurRelance {
    const existant = this.#etats.get(sessionId);
    if (existant !== undefined) return existant;
    const initial: EtatCompteurRelance = {
      sessionId,
      tentativesEffectuees: 0,
      plafond: plafond ?? this.plafondDefaut,
    };
    this.#etats.set(sessionId, initial);
    return initial;
  }

  /** `true` si une relance supplémentaire resterait sous le plafond. */
  sousLePlafond(sessionId: string): boolean {
    const etat = this.etat(sessionId);
    return etat.tentativesEffectuees < etat.plafond;
  }

  /**
   * Enregistre qu'une relance vient d'être décidée. À appeler uniquement quand la
   * politique a effectivement choisi `relancer` — un `remonter` ou un `echec_definitif`
   * n'incrémente rien : ce ne sont pas des tentatives.
   */
  enregistrerTentative(sessionId: string): EtatCompteurRelance {
    const precedent = this.etat(sessionId);
    const suivant: EtatCompteurRelance = { ...precedent, tentativesEffectuees: precedent.tentativesEffectuees + 1 };
    this.#etats.set(sessionId, suivant);
    return suivant;
  }

  /** Remise à zéro explicite — par ex. après un `completed` propre sur une session réutilisée. */
  reinitialiser(sessionId: string): void {
    this.#etats.delete(sessionId);
  }
}
