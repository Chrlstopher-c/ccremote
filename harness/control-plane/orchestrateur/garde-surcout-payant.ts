/**
 * Responsabilité : refuser PROPREMENT un dispatch dont le compte retenu est DÉJÀ
 * constaté en surcoût payant (C2, PLAN-OPTIMISATION-QUOTAS.md, cause 5 / cause 3 de
 * l'audit qualité). `mandat.ts` (bloc CARBURANT) ne portait qu'une consigne au modèle
 * (« ne réessaie pas en boucle ») — jamais un verrou de code : rien n'empêchait le
 * dispatch de partir quand même et de basculer en `extra_usage` payant SANS que personne
 * ne le sache (H-63.1, `outils-inspection.ts` : « rejected ne coupe pas la session »).
 *
 * `☠` FRONTIÈRE STRICTE — ce module NE CHOISIT PAS de compte et NE TOUCHE PAS à
 * `choisirCompteEquipe`/`saturation-compte.ts`/`plafond-parc.ts`. Il lit un FAIT déjà
 * enregistré par la sonde de quotas (`quota_compte.utilise_overage`) sur le compte QUE
 * `choisirCompteEquipe` a déjà retenu, et refuse AVANT la première écriture si ce fait est
 * vrai. La rotation reste exactement celle décidée par Chris (y compris le choix manuel
 * verrouillé qui heurte volontairement un mur de saturation, 24/08) — seul le franchissement
 * du SEUIL DE PAYANT, distinct de la simple saturation de fenêtre, est arrêté ici.
 */

import type { Registre } from '../registre/index.ts';

export class ErreurCompteEnSurcoutPayant extends Error {
  constructor(readonly compteId: string) {
    super(
      `dispatch refusé : le compte « ${compteId} » est déjà EN SURCOÛT PAYANT (extra_usage) — ` +
        'lancer une équipe dessus consommerait de l’argent réel en silence. Attends un reset de ' +
        'fenêtre ou choisis un autre compte plutôt que de relancer en boucle.',
    );
    this.name = 'ErreurCompteEnSurcoutPayant';
  }
}

/** `true` si au moins une fenêtre de ce compte est constatée EN surcoût payant (fait mesuré, pas une prédiction). */
export function compteEnSurcoutPayant(registre: Registre, compteId: string): boolean {
  return registre.comptes.listerQuotas(compteId).some((q) => q.utiliseOverage === true);
}

/**
 * `☠ CASSE` (C2) — point d'application réel : lève AVANT toute écriture si le compte déjà
 * choisi par `choisirCompteEquipe` est en surcoût payant. À appeler juste après la
 * sélection, jamais en remplacement d'elle.
 */
export function assertCompteNonEnSurcoutPayant(registre: Registre, compteId: string): void {
  if (compteEnSurcoutPayant(registre, compteId)) {
    throw new ErreurCompteEnSurcoutPayant(compteId);
  }
}
