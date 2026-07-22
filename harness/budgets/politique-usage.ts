/**
 * Responsabilité : décider quoi faire d'une classification de message d'usage (G.1.4,
 * mission M-51, acceptation (c)).
 *
 * `☠ CASSE` (panne #16, cœur testable de la mission) — un avertissement ne suspend
 * JAMAIS les créations et ne notifie JAMAIS ; seule une limite réellement atteinte le
 * fait. Confondre les deux fait s'arrêter des équipes sans raison (avertissement traité
 * en erreur) ou laisse le parc continuer de créer des missions au-delà d'une vraie
 * limite (erreur traitée en avertissement) — les deux sens du défaut sont couverts.
 */

import type { ClassificationMessageUsage, DecisionUsage } from './types.ts';

export function deciderActionUsage(classification: ClassificationMessageUsage): DecisionUsage {
  switch (classification.categorie) {
    case 'limite_atteinte':
      return {
        classification,
        suspendreCreations: true,
        notifier: true,
        tracer: true,
        motif: "limite d'usage réellement atteinte (USAGE_LIMIT_ERROR_PREFIXES) — suspendre les créations, notifier (G.1.4)",
      };

    case 'transition':
      return {
        classification,
        suspendreCreations: false,
        notifier: true,
        tracer: true,
        motif: "transition vers l'overage/les crédits — pas une erreur, notifier sans suspendre (G.1.4)",
      };

    case 'avertissement':
      return {
        classification,
        suspendreCreations: false,
        notifier: false,
        tracer: true,
        motif: "avertissement d'approche de limite — tracer seulement, ne jamais notifier (G.1.4, ☠ panne #16)",
      };

    case 'aucune':
      return {
        classification,
        suspendreCreations: false,
        notifier: false,
        tracer: false,
        motif: "texte non reconnu comme message d'usage — rien à faire",
      };

    default: {
      // Garde-fou d'exhaustivité : une catégorie nouvelle non traitée doit échouer
      // bruyamment plutôt que de deviner un comportement (même doctrine que relance/).
      const exhaustif: never = classification.categorie;
      throw new Error(`catégorie de message d'usage non gérée : ${String(exhaustif)}`);
    }
  }
}
