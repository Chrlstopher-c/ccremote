/**
 * Responsabilité : déclenchement périodique de la passe de consolidation (C-4, SPEC §5,
 * PLAN-PORTAGE.md E10) — ce que `consolidation.ts` ne fait pas lui-même : décider QUAND
 * rappeler `executerConsolidation`. Toute mutation reste dans `consolidation.ts` ; ce fichier
 * ne fait que planifier des ticks et composer les dépendances à chaque tick.
 *
 * `☠` `aucuneMissionActive` et `obtenirBase` sont des THUNKS, jamais des valeurs mémorisées à
 * la construction : ils sont relus à CHAQUE tick. L'appelant (superviseur) calcule
 * `aucuneMissionActive` depuis SON registre — la seule source honnête sur ce qui tourne sur la
 * machine (H-15) — jamais une estimation de durée ni un compteur maison (SPEC §5, C-4 `☠`).
 *
 * `☠` NE LÈVE JAMAIS (SPEC §1) : une panne de `executerConsolidation` (déjà attrapée en
 * interne) ou de la composition d'un tick (accès registre, ouverture de base) reste locale à
 * ce tick et n'interrompt jamais la reprogrammation suivante — la discipline qui prime sur
 * tout, ici comme dans `service/file-attente.ts` (E6).
 *
 * Conception inspirée de Hermes Agent (Nous Research) — MIT. Transposition indépendante en TypeScript.
 */

import type { Database } from 'bun:sqlite';
import { journal } from '../logger.ts';
import { executerConsolidation } from './consolidation.ts';

/**
 * Fréquence de VÉRIFICATION des portes — pas l'intervalle métier de 7 jours
 * (`INTERVALLE_MIN_MS`, seul verrou temporel réel de `consolidation.ts`). Assez fin pour ne
 * jamais rater la fenêtre de plus d'une demi-journée, assez grossier pour ne rien surcharger.
 */
export const INTERVALLE_VERIFICATION_MS_DEFAUT = 6 * 60 * 60 * 1000;

export interface DependancesConsolidationPeriodique {
  /** `null` ⇒ base d'apprentissage indisponible pour ce process (même contrat qu'E6) : tick ignoré. */
  readonly obtenirBase: () => Database | null;
  readonly cheminDb: string;
  readonly racineCompetences: string;
  /** `☠` Relu à CHAQUE tick — jamais mémorisé (voir en-tête). */
  readonly aucuneMissionActive: () => boolean;
  readonly racineSauvegardes?: string;
  readonly racineRapports?: string;
  readonly maintenant?: () => number;
  readonly intervalleVerificationMs?: number;
  /** Réel = `setTimeout`, contrôlable en test — même contrat que le reste du superviseur. */
  readonly planifier: (delaiMs: number, tache: () => void) => void;
}

export interface ConsolidationPeriodique {
  /** Arrête la reprogrammation. Un tick déjà en cours va à son terme (jamais interrompu en vol). */
  readonly arreter: () => void;
}

/** Un tick : ouvre la base si besoin, tente une passe, ne lève jamais. */
function executerTick(deps: DependancesConsolidationPeriodique): void {
  try {
    const db = deps.obtenirBase();
    if (db === null) {
      journal.debug('consolidation périodique : base d’apprentissage indisponible — tick ignoré');
      return;
    }
    const resultat = executerConsolidation({
      db,
      cheminDb: deps.cheminDb,
      racineCompetences: deps.racineCompetences,
      aucuneMissionActive: deps.aucuneMissionActive(),
      racineSauvegardes: deps.racineSauvegardes,
      racineRapports: deps.racineRapports,
      maintenant: deps.maintenant?.(),
    });
    if (resultat.executee) {
      journal.info({ rapportChemin: resultat.rapportChemin }, 'consolidation périodique déclenchée automatiquement (C-4)');
    } else {
      journal.debug({ motif: resultat.motif }, 'consolidation périodique différée (C-4)');
    }
  } catch (cause) {
    // `☠` Dernier filet : `executerConsolidation` ne lève déjà jamais, mais la composition
    // ci-dessus (`obtenirBase`, `aucuneMissionActive`) pourrait échouer de façon imprévue —
    // ça ne doit jamais interrompre la reprogrammation du tick suivant.
    journal.error({ err: cause }, 'consolidation périodique : tick en échec — non bloquant, reprogrammé');
  }
}

/**
 * Programme une vérification récurrente des portes de `executerConsolidation` (C-4). Chaque
 * tick se reprogramme lui-même après exécution : `planifier` est le SEUL point qui décide
 * quand le prochain tick arrive (jamais de boucle serrée — réel = `setTimeout`).
 */
export function demarrerConsolidationPeriodique(deps: DependancesConsolidationPeriodique): ConsolidationPeriodique {
  let arrete = false;
  const intervalle = deps.intervalleVerificationMs ?? INTERVALLE_VERIFICATION_MS_DEFAUT;

  const tick = (): void => {
    if (arrete) return;
    executerTick(deps);
    if (!arrete) deps.planifier(intervalle, tick);
  };

  deps.planifier(intervalle, tick);
  return {
    arreter: () => {
      arrete = true;
    },
  };
}
