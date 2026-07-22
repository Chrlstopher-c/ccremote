/**
 * Responsabilité : la politique de relance elle-même (B.3.2 + B.3.3, mission M-34).
 *
 * Combine la classification (a), le refus d'auto-relance sur borne/structurel (b, c) et le
 * plafond de tentatives (d). C'est le seul point d'entrée que le reste du harness doit
 * appeler — ni `classifierTerminaison` ni `CompteurRelances` ne suffisent seuls à respecter
 * l'acceptation de la mission.
 */

import type { JournalPannes } from '../test-harness/journal/journal-pannes.ts';
import { delaiBackoffMs } from './backoff.ts';
import { classifierTerminaison } from './classification.ts';
import { CompteurRelances } from './compteur-relances.ts';
import type { DecisionRelance } from './types.ts';

export interface DependancesPolitiqueRelance {
  readonly compteur: CompteurRelances;
  /** Optionnel : le harnais de pannes n'existe qu'en test, jamais en production. */
  readonly journal?: JournalPannes;
}

/**
 * Décide quoi faire d'une sortie de tour pour une équipe donnée.
 *
 * `☠ CASSE` (acceptation (b)) — un échec **structurel** n'est jamais relancé : relancer
 * reproduit l'échec à l'identique (même prompt trop long, même sortie d'outil malformée),
 * ça consomme du budget sans jamais aboutir (panne #12 de la grille de revue). Verdict
 * immédiat `echec_definitif`, sans attendre le plafond — attendre serait déjà une relance
 * implicite du même problème.
 *
 * `☠ CASSE` (acceptation (c)) — `budget_exhausted` (groupe `borne_atteinte`) n'est **jamais**
 * relancé automatiquement (panne #13). Verdict `remonter` : ce n'est pas un échec de
 * l'équipe, c'est une borne prévue par G.1/H-68 — la décision de continuer appartient à ce
 * qui gère le budget, pas à cette politique.
 */
export function deciderRelance(
  sessionId: string,
  raisonBrute: string | undefined,
  deps: DependancesPolitiqueRelance,
): DecisionRelance {
  const classification = classifierTerminaison(raisonBrute);
  const { compteur, journal } = deps;

  switch (classification.groupe) {
    case 'fin_normale':
      compteur.reinitialiser(sessionId);
      return { action: 'rien', motif: 'tour terminé normalement (completed)', classification };

    case 'volontaire':
      return { action: 'rien', motif: 'arrêt volontaire — pas un échec à relancer', classification };

    case 'borne_atteinte':
      journal?.enregistrer('relance_refusee_borne', { sessionId, raison: classification.raisonBrute });
      return {
        action: 'remonter',
        motif: 'borne atteinte (max_turns/budget_exhausted) — jamais de relance automatique (acceptation c)',
        classification,
      };

    case 'quota':
      journal?.enregistrer('relance_refusee_quota', { sessionId, raison: classification.raisonBrute });
      return {
        action: 'remonter',
        motif: 'quota de compte (blocking_limit/rapid_refill_breaker) — relève de G.2, pas de cette politique',
        classification,
      };

    case 'non_couverte':
      journal?.enregistrer('raison_terminaison_non_couverte', { sessionId, raison: classification.raisonBrute });
      return {
        action: 'remonter',
        motif:
          'raison journalisée telle quelle : absente de la table de groupement ou inconnue du SDK — ' +
          'jamais traitée comme un cas générique, jamais relancée par défaut',
        classification,
      };

    case 'structurel': {
      const etat = compteur.etat(sessionId);
      journal?.enregistrer('relance_refusee_structurel', { sessionId, raison: classification.raisonBrute });
      return {
        action: 'echec_definitif',
        motif: 'échec structurel — relancer reproduirait l\'échec à l\'identique (acceptation b)',
        classification,
        tentativesEffectuees: etat.tentativesEffectuees,
      };
    }

    case 'transitoire': {
      if (!compteur.sousLePlafond(sessionId)) {
        const etat = compteur.etat(sessionId);
        journal?.enregistrer('plafond_relance_atteint', { sessionId, tentatives: etat.tentativesEffectuees });
        return {
          action: 'echec_definitif',
          motif: `plafond de relances atteint (${etat.tentativesEffectuees}/${etat.plafond})`,
          classification,
          tentativesEffectuees: etat.tentativesEffectuees,
        };
      }
      const etat = compteur.enregistrerTentative(sessionId);
      journal?.enregistrer('relance_decidee', { sessionId, tentative: etat.tentativesEffectuees });
      return {
        action: 'relancer',
        motif: 'échec transitoire (api_error/model_error/turn_setup_failed) — resume + backoff',
        classification,
        resume: sessionId,
        forkSession: false,
        tentative: etat.tentativesEffectuees,
        delaiMs: delaiBackoffMs(etat.tentativesEffectuees),
      };
    }

    default: {
      // Garde-fou d'exhaustivité : si un septième groupe apparaît un jour dans types.ts
      // sans être traité ici, échouer bruyamment plutôt que de deviner un comportement.
      const exhaustif: never = classification.groupe;
      throw new Error(`groupe de terminaison non géré : ${String(exhaustif)}`);
    }
  }
}

export { CompteurRelances } from './compteur-relances.ts';
export { classifierTerminaison } from './classification.ts';
