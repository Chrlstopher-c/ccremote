/**
 * Responsabilité : transformer un verdict du juge en décision de coupure (H-68). Pur,
 * aucune I/O — n'appelle jamais `interrupt()`/`arreter()` lui-même, ne fait que décider.
 *
 * `☠ CASSE` (H-68, non négociable) — biais asymétrique : un juge qui se trompe en
 * disant « boucle » détruit du travail légitime en silence, un juge qui rate une vraie
 * boucle ne coûte qu'un peu de temps de plus jusqu'au prochain palier (ou au filet
 * `maxBudgetUsd`, G.1.1). Donc, dans le doute, ON LAISSE CONTINUER :
 * - `incertain` NE COUPE JAMAIS, quel que soit le palier ;
 * - seul `boucle` coupe ;
 * - un `incertain` répété sur plusieurs paliers CONSÉCUTIFS escalade à l'humain (H-61)
 *   au lieu de trancher seul — ni couper, ni ignorer indéfiniment.
 */

import type { DecisionCoupure, EtatEscalade, ResultatDecision, VerdictJuge } from './types.ts';

/** Nombre d'`incertain` consécutifs avant escalade humaine (H-68 : « plusieurs paliers »). */
export const SEUIL_ESCALADE_INCERTAINS_PAR_DEFAUT = 3;

export function deciderCoupure(
  verdict: VerdictJuge,
  etat: EtatEscalade,
  seuilEscaladeIncertains: number = SEUIL_ESCALADE_INCERTAINS_PAR_DEFAUT,
): ResultatDecision {
  if (verdict.verdict === 'boucle') {
    return {
      decision: {
        action: 'couper',
        motif: `verdict « boucle » du juge Haiku : ${verdict.motif} (H-68)`,
      },
      nouvelEtat: { incertainsConsecutifs: 0 },
    };
  }

  if (verdict.verdict === 'progres') {
    return {
      decision: {
        action: 'continuer',
        motif: `verdict « progres » du juge Haiku : ${verdict.motif}`,
      },
      nouvelEtat: { incertainsConsecutifs: 0 },
    };
  }

  return deciderSurIncertain(verdict, etat, seuilEscaladeIncertains);
}

/**
 * `☠` Isolé dans sa propre fonction pour que le cas « incertain ne coupe jamais » soit
 * visible et testable indépendamment de `boucle`/`progres` — c'est le cœur de H-68.
 */
function deciderSurIncertain(
  verdict: VerdictJuge,
  etat: EtatEscalade,
  seuilEscaladeIncertains: number,
): ResultatDecision {
  const incertainsConsecutifs = etat.incertainsConsecutifs + 1;

  if (incertainsConsecutifs >= seuilEscaladeIncertains) {
    return {
      decision: {
        action: 'escalader',
        motif:
          `${String(incertainsConsecutifs)} verdicts « incertain » consécutifs (seuil ${String(seuilEscaladeIncertains)}) ` +
          `— dernier motif : ${verdict.motif}. Escalade à l'humain (H-61), jamais tranché seul.`,
      },
      nouvelEtat: { incertainsConsecutifs: 0 },
    };
  }

  return {
    decision: {
      action: 'continuer',
      motif:
        `verdict « incertain » (${String(incertainsConsecutifs)}/${String(seuilEscaladeIncertains)}) — ` +
        `${verdict.motif}. Ne coupe jamais sur incertain (H-68, biais asymétrique).`,
    },
    nouvelEtat: { incertainsConsecutifs },
  };
}
