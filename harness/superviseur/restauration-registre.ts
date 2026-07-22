/**
 * Responsabilité : restaurer le registre de workers au démarrage du superviseur PC
 * (dette n°1, TODO.md — le CŒUR de la dette, pas l'écriture disque elle-même).
 *
 * Reproduit et ferme le scénario de `validation-proprietes/isolation.test.ts`
 * (« isolation — CONDITION : dette n°1 ») : registre en mémoire vidé par un
 * redémarrage, worker resté vivant sur disque, candidat entrant qui ne devait plus
 * être accepté en silence. Ici, on relit ce qui a survécu et on le rend au fencing
 * comme concurrent — voir le câblage dans `superviseur-workers.ts`.
 *
 * `☠ Biais asymétrique non négociable` : `indetermine` ne libère JAMAIS le
 * worktree. Se tromper en libérant détruit du travail ; se tromper en gardant
 * coûte une intervention humaine — les deux ne sont PAS équivalents.
 */

import { superviseurLogger } from './logger.ts';
import { revaliderProcess, type LecteurStarttime } from './revalidation-process.ts';
import type { PersistanceRegistre } from './persistance-registre.ts';
import type { ConcurrentRestaure } from './types.ts';

export interface DependancesRestauration {
  /** Injectable pour les tests : jamais de vraie lecture `/proc` en unitaire. */
  readonly lireStarttime?: LecteurStarttime;
}

/**
 * `☠` Ne catch RIEN sur `persistance.tous()` : un échec de lecture au démarrage
 * doit arrêter le démarrage, jamais être avalé en « rien à restaurer » — ce serait
 * le pire faux négatif possible pour cette dette (voir `persistance-registre.ts`).
 */
export function restaurerRegistre(persistance: PersistanceRegistre, deps: DependancesRestauration = {}): readonly ConcurrentRestaure[] {
  const lignes = persistance.tous();
  const resultat: ConcurrentRestaure[] = [];
  const compteurs = { vivant_confirme: 0, mort_confirme: 0, indetermine: 0, deja_mort_en_base: 0 };

  for (const ligne of lignes) {
    if (!ligne.vivant) {
      // Déjà marqué mort avant le redémarrage (marquerMort() persisté) : aucune
      // revalidation à faire, la donnée est déjà tranchée.
      compteurs.deja_mort_en_base += 1;
      resultat.push({
        sessionId: ligne.sessionId,
        missionId: ligne.missionId,
        worktree: ligne.worktree,
        epoch: ligne.epoch,
        pid: ligne.pid,
        pidStarttime: ligne.pidStarttime,
        spec: ligne.spec,
        etat: 'mort_confirme',
        vivant: false,
      });
      continue;
    }

    const etat =
      deps.lireStarttime === undefined
        ? revaliderProcess(ligne.pid, ligne.pidStarttime)
        : revaliderProcess(ligne.pid, ligne.pidStarttime, deps.lireStarttime);
    compteurs[etat] += 1;

    resultat.push({
      sessionId: ligne.sessionId,
      missionId: ligne.missionId,
      worktree: ligne.worktree,
      epoch: ligne.epoch,
      pid: ligne.pid,
      pidStarttime: ligne.pidStarttime,
      spec: ligne.spec,
      etat,
      // ☠ indetermine ⇒ vivant reste true : n'ouvre JAMAIS le worktree dans le doute.
      vivant: etat !== 'mort_confirme',
    });
  }

  superviseurLogger.info({ ...compteurs, total: lignes.length }, 'registre restauré depuis disque (dette n°1, TODO.md)');
  return resultat;
}
