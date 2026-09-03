/**
 * Responsabilité : le plafond dur d'une équipe, et sa relation avec l'échelle
 * d'inspection anti-boucle.
 *
 * Deux mécanismes distincts, souvent confondus :
 *  - les PALIERS (H-68) sont des DÉCLENCHEURS d'inspection. Franchir 12 $ fait
 *    regarder le juge Haiku ; il tranche, et l'équipe continue le plus souvent.
 *  - le PLAFOND est un filet de dernier recours. Il ne juge rien : il coupe.
 *    Transmis au SDK en `maxBudgetUsd`, il rend la session inutilisable.
 *
 * `☠` Les deux valaient 12 $. L'équipe mourait donc EXACTEMENT au moment où elle
 * devait être inspectée pour la première fois — les huit paliers suivants
 * (30 → 200 $) étaient inatteignables par construction, et l'échelle entière
 * était décorative. Mesuré en prod le 01/08 : « au bout des 12 $ elle devient off
 * et inutilisable ».
 *
 * D'où la DÉRIVATION plutôt qu'une seconde constante : deux nombres indépendants
 * censés rester ordonnés finissent toujours par se croiser, et personne ne le
 * voit — c'est exactement ce qui s'est produit. Changer l'échelle déplace le
 * plafond avec elle.
 */

import { PALIERS_PAR_DEFAUT } from '../anti-boucle/types.ts';

/**
 * De combien le filet passe au-dessus du dernier palier. Il doit rester de la
 * place pour que la dernière inspection serve à quelque chose : un plafond posé
 * SUR le dernier palier couperait avant que le juge ait rendu son verdict.
 */
export const MARGE_PLAFOND_USD = 50;

/** Le dernier palier de l'échelle — au-delà, plus aucune inspection n'est prévue. */
export const DERNIER_PALIER_USD: number = Math.max(...PALIERS_PAR_DEFAUT.seuilsUsd);

/**
 * Plafond dur par équipe. `☠` DÉRIVÉ, jamais saisi : voir l'en-tête.
 * Vaut aujourd'hui 250 $ (dernier palier 200 $ + marge 50 $). Filet de dernier
 * recours catastrophe — jamais le budget qu'une équipe reçoit par défaut, voir
 * `BUDGET_EQUIPE_DEFAUT_USD` ci-dessous.
 */
export const PLAFOND_EQUIPE_USD: number = DERNIER_PALIER_USD + MARGE_PLAFOND_USD;

/**
 * Budget par défaut PAR ACTIVATION d'équipe, quand l'orchestrateur n'en
 * spécifie aucun. Distinct de `PLAFOND_EQUIPE_USD` : celui-ci reste le
 * garde-fou catastrophe ultime, dérivé de l'échelle d'inspection et jamais
 * changé ici. 50 $ ≈ 8× la pire équipe Opus normale mesurée à 6,40 $ — large
 * marge sans rouvrir la question du plafond catastrophe.
 *
 * `☠` PAR ACTIVATION, jamais un cumul sur la vie d'une team persistante : une
 * team qui enchaîne plusieurs features cumule potentiellement plus au total,
 * mais chaque exécution reste bornée à ce montant.
 */
export const BUDGET_EQUIPE_DEFAUT_USD = 50;

/**
 * Le plafond effectif d'un mandat : celui qu'il porte s'il en porte un, le
 * défaut fourni par l'appelant sinon (`PLAFOND_EQUIPE_USD` si omis — garde-fou
 * catastrophe, jamais changé par cette signature).
 *
 * `☠` Un budget explicite INFÉRIEUR au premier palier est accepté — c'est un
 * choix légitime de l'opérateur pour une mission courte — mais l'appelant doit
 * savoir qu'il coupe alors avant toute inspection. `plafondSousLePremierPalier`
 * existe pour le lui dire.
 */
export function plafondEffectifUsd(
  budgetMandatUsd: number | null | undefined,
  defautUsd: number = PLAFOND_EQUIPE_USD,
): number {
  return typeof budgetMandatUsd === 'number' && budgetMandatUsd > 0 ? budgetMandatUsd : defautUsd;
}

/** Ce plafond coupe-t-il avant la première inspection du juge ? */
export function plafondSousLePremierPalier(plafondUsd: number): boolean {
  return plafondUsd <= Math.min(...PALIERS_PAR_DEFAUT.seuilsUsd);
}
