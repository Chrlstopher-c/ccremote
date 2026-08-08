/**
 * Responsabilité : point d'entrée UNIQUE de la file d'apprentissage à la clôture d'une
 * mission (SPEC §6, PLAN-PORTAGE.md E6). La persistance de la file EST `passe_apprentissage`
 * (SPEC §5.7 `☠`) : `mission_id` en clé primaire garantit l'unicité, `estMissionTraitee`
 * garde l'entrée d'un second traitement avant même d'appeler le modèle.
 *
 * `☠` APPEL NON BLOQUANT PAR CONSTRUCTION (PLAN-PORTAGE.md E6, SPEC §6) : cette fonction est
 * async et fait de l'I/O (disque, réseau) — elle DOIT être invoquée avec `void enfilerPasseApprentissage(...)`
 * par l'appelant (`superviseur-workers.ts`), jamais `await`ée dans le chemin de clôture. Elle
 * ne lève jamais, de sorte qu'un `.catch()` supplémentaire côté appelant est une pure
 * précaution, pas une nécessité.
 *
 * Conception inspirée de Hermes Agent (Nous Research) — MIT. Transposition indépendante en TypeScript.
 */

import type { Database } from 'bun:sqlite';
import { estMissionTraitee } from '../base/lecons.ts';
import type { ClientInference } from '../extraction/client-inference.ts';
import { journal } from '../logger.ts';
import { executerPasseCloture, type EntreePasseCloture, type ResultatPasseCloture } from './passe-cloture.ts';

export interface DependancesFileAttente {
  readonly db: Database;
  readonly client: ClientInference;
}

/**
 * Enfile (et traite immédiatement — la file EST la table `passe_apprentissage`, il n'y a pas
 * de second étage à vider) une passe d'apprentissage pour une mission conclue.
 *
 * `null` ⇒ mission déjà traitée, ignorée sans appeler le modèle (idempotence, SPEC §5.7 `☠`).
 * Ne lève JAMAIS — toute panne interne est journalisée et rendue comme `erreur` dans le résultat.
 */
export async function enfilerPasseApprentissage(
  deps: DependancesFileAttente,
  entree: EntreePasseCloture,
): Promise<ResultatPasseCloture | null> {
  try {
    if (estMissionTraitee(deps.db, entree.missionId)) {
      journal.debug({ missionId: entree.missionId }, 'passe déjà enregistrée pour cette mission — ignorée (idempotence)');
      return null;
    }
    return await executerPasseCloture(deps.db, deps.client, entree);
  } catch (cause) {
    // `☠` Dernier filet : `executerPasseCloture` ne lève déjà jamais, mais `estMissionTraitee`
    // (lecture SQLite) pourrait échouer (base verrouillée). Une panne ICI ne doit jamais
    // remonter jusqu'à l'appelant — c'est tout l'objet de E6.
    journal.error({ err: cause, missionId: entree.missionId }, 'enfilerPasseApprentissage en échec — jamais bloquant');
    return null;
  }
}
