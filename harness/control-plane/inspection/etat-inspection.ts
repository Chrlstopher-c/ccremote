/**
 * Responsabilité : le cycle de vie d'une inspection à la demande (H-68).
 *
 * Une inspection RÉPOND, elle ne coupe jamais d'elle-même. Un verdict `boucle`
 * ouvre donc une décision, et cette décision est un état à part entière :
 *
 *   progres / incertain              → rien à décider, l'équipe continue
 *   boucle → en_attente              → l'opérateur n'a pas encore tranché
 *          → confirme                → il a arrêté l'équipe
 *          → decline                 → il a vu et passé outre, l'équipe continue
 *
 * `☠` `decline` existe pour une raison précise : sans lui, « j'ai vu l'alerte et
 * je poursuis en connaissance de cause » serait indistinguable de « je n'ai
 * jamais regardé ». Ce sont deux situations opposées face à une équipe qui part
 * en boucle, et c'est exactement ce qu'on veut lire d'un coup d'œil sur le Parc.
 */

export type VerdictInspection = 'progres' | 'incertain' | 'boucle';
export type DecisionInspection = 'en_attente' | 'confirme' | 'decline';

export interface EtatInspection {
  readonly verdict: VerdictInspection | null;
  readonly motif: string | null;
  readonly a: number | null;
  readonly decision: DecisionInspection | null;
}

export const INSPECTION_VIERGE: EtatInspection = { verdict: null, motif: null, a: null, decision: null };

/**
 * Seul un `boucle` ouvre une décision. `☠` Poser `en_attente` sur un `progres`
 * ferait clignoter le Parc pour une équipe qui va bien — et l'alerte qui crie
 * sans raison est celle qu'on cesse de lire.
 */
export function decisionInitiale(verdict: VerdictInspection): DecisionInspection | null {
  return verdict === 'boucle' ? 'en_attente' : null;
}

/** Une inspection réclame-t-elle encore un arbitrage ? */
export function attendArbitrage(etat: EtatInspection): boolean {
  return etat.verdict === 'boucle' && etat.decision === 'en_attente';
}

/**
 * Peut-on trancher cette inspection ?
 *
 * `☠` Refuse si rien n'attend : trancher deux fois arrêterait une équipe que
 * l'opérateur venait de décider de laisser tourner. Le message nomme l'état
 * réel plutôt que de dire non.
 */
export function verdictArbitrable(etat: EtatInspection): { readonly ok: boolean; readonly raison?: string } {
  if (etat.verdict === null) return { ok: false, raison: 'aucune inspection n’a encore été lancée sur cette équipe' };
  if (etat.verdict !== 'boucle') return { ok: false, raison: `le dernier verdict est « ${etat.verdict} » — il n’y a rien à arbitrer` };
  if (etat.decision !== 'en_attente') {
    return { ok: false, raison: `cette inspection a déjà été tranchée (${etat.decision}) — relance une inspection pour un avis à jour` };
  }
  return { ok: true };
}

/** Libellé court pour la carte du Parc — dit l'état, jamais le détail. */
export function libelleInspection(etat: EtatInspection): string | null {
  if (etat.verdict === null) return null;
  if (etat.verdict === 'progres') return 'inspection : progrès';
  if (etat.verdict === 'incertain') return 'inspection : incertain';
  if (etat.decision === 'confirme') return 'boucle — équipe arrêtée';
  if (etat.decision === 'decline') return 'boucle — poursuite assumée';
  return 'boucle — décision attendue';
}
