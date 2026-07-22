/**
 * Responsabilité : délai de recul exponentiel pour la relance des échecs transitoires
 * (B.3.1 : « relance avec `resume`, backoff, compteur »).
 *
 * Fonction pure du numéro de tentative — testable sans horloge réelle ni horloge simulée.
 */

const DELAI_BASE_MS = 1_000;
const DELAI_PLAFOND_MS = 60_000;

/** `tentative` = 1 pour la première relance. Double à chaque tentative, plafonné. */
export function delaiBackoffMs(tentative: number): number {
  if (tentative < 1) {
    throw new RangeError(`tentative doit être ≥ 1, reçu ${tentative}`);
  }
  const brut = DELAI_BASE_MS * 2 ** (tentative - 1);
  return Math.min(brut, DELAI_PLAFOND_MS);
}
