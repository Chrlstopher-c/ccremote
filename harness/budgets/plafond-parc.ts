/**
 * Responsabilité : plafond de parc agrégé (G.1.3, mission M-51, acceptation (b)).
 *
 * Spec d'origine : plafond en dollars agrégé sur le parc. `⚠ HYP corrigée (H-58, H-70)` —
 * inobservable sur un compte par abonnement (`*_dollars` reviennent `null`, mesuré) : ce
 * module transpose la même intention en **pourcentage d'utilisation de quota** par
 * compte (`rate_limits.<fenêtre>.utilization`, H-54), la seule grandeur mesurable.
 *
 * Désactivé par défaut (H-58 : « codé, sans seuil par défaut »)  — `seuilUtilisationPct`
 * non défini ⇒ toujours autorisé.
 *
 * `☠` Preuve par le type (G.1.3 : « il ne tue pas ») : `DecisionPlafondParc` ne porte
 * aucun champ permettant de désigner une mission à terminer. Ce module ne PEUT que
 * refuser une création à venir, jamais agir sur ce qui tourne déjà.
 */

import type { ConfigPlafondParc, DecisionPlafondParc, RelevePourPlafond } from './types.ts';

/**
 * Décide si une NOUVELLE mission peut être créée sur un compte donné.
 * `releves` : les fenêtres de quota observées pour CE compte uniquement (H-63 : la jauge
 * est par compte, jamais agrégée entre comptes — au caller de filtrer avant l'appel).
 */
export function deciderCreationMission(
  releves: readonly RelevePourPlafond[],
  config: ConfigPlafondParc,
): DecisionPlafondParc {
  // Canal structuré (H-54) indépendant du seuil configuré : un `rejected` dit que le
  // compte a DÉJÀ refusé des requêtes sur cette fenêtre — pas la peine d'attendre un
  // pourcentage pour le constater. Actif même plafond désactivé (undefined).
  const rejetee = releves.find((releve) => releve.statut === 'rejected');
  if (rejetee !== undefined) {
    return {
      autorise: false,
      motif: `fenêtre « ${rejetee.typeFenetre} » déjà « rejected » (H-54) — création refusée, missions en cours non touchées`,
    };
  }

  if (config.seuilUtilisationPct === undefined) {
    return { autorise: true, motif: 'plafond de parc désactivé — aucun seuil configuré (H-58, G.1.3)' };
  }

  const seuil = config.seuilUtilisationPct;
  const depasse = releves.find((releve) => releve.utilisation !== null && releve.utilisation >= seuil);

  if (depasse !== undefined) {
    return {
      autorise: false,
      motif:
        `fenêtre « ${depasse.typeFenetre} » à ${String(depasse.utilisation)}% ≥ seuil ${String(seuil)}% — ` +
        'création refusée, missions déjà en cours non touchées (G.1.3)',
    };
  }

  return { autorise: true, motif: `toutes les fenêtres observées sont sous le seuil (${String(seuil)}%)` };
}
