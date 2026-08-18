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
 *
 * **H-75 — redémarrage de la MACHINE, pas seulement du superviseur** :
 * `starttime` est compté depuis le boot ; après un redémarrage, un pid
 * quelconque du nouveau boot peut porter le même `(pid, starttime)` qu'un
 * worker de la veille. `identite-boot.ts` compare l'identité du boot AVANT
 * toute lecture de `/proc/<pid>/stat` — un boot différent tranche
 * `mort_confirme` sans lire `/proc`, un boot illisible tranche `indetermine`
 * sans jamais tomber sur `mort_confirme` (même biais que ci-dessus).
 */

import { comparerBootId, lireBootIdProc, type LecteurBootId } from './identite-boot.ts';
import { superviseurLogger } from './logger.ts';
import { revaliderProcess, type LecteurStarttime } from './revalidation-process.ts';
import type { PersistanceRegistre } from './persistance-registre.ts';
import type { ConcurrentRestaure, EtatRevalidationProcess } from './types.ts';

export interface DependancesRestauration {
  /** Injectable pour les tests : jamais de vraie lecture `/proc` en unitaire. */
  readonly lireStarttime?: LecteurStarttime;
  /** Injectable pour les tests (H-75) : jamais de vraie lecture `/proc` en unitaire. */
  readonly lireBootId?: LecteurBootId;
}

/**
 * `☠` Ne catch RIEN sur `persistance.tous()` : un échec de lecture au démarrage
 * doit arrêter le démarrage, jamais être avalé en « rien à restaurer » — ce serait
 * le pire faux négatif possible pour cette dette (voir `persistance-registre.ts`).
 */
export function restaurerRegistre(persistance: PersistanceRegistre, deps: DependancesRestauration = {}): readonly ConcurrentRestaure[] {
  const lignes = persistance.tous();
  const resultat: ConcurrentRestaure[] = [];
  const compteurs = {
    vivant_confirme: 0,
    mort_confirme: 0,
    indetermine: 0,
    deja_mort_en_base: 0,
    // Sous-détail de mort_confirme (H-75) : combien sont morts par CHANGEMENT DE
    // BOOT (cas nominal « j'éteins, je me couche, je relance ») plutôt que par
    // pid recyclé au sein du même boot — utile au diagnostic, jamais utilisé
    // pour décider (la décision est déjà prise ligne par ligne ci-dessous).
    mort_par_changement_de_boot: 0,
  };
  const bootIdCourant = (deps.lireBootId ?? lireBootIdProc)();

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

    // `☠` Ordre strict (H-75) : la comparaison de boot passe AVANT toute lecture
    // de `/proc/<pid>/stat`. Un boot différent tranche `mort_confirme` sans
    // jamais appeler `lireStarttime` — c'est ce qui rend le cas nominal du
    // redémarrage nocturne net, et ce qui doit rester prouvable sans redémarrer
    // une vraie machine (voir le test « aucune lecture de /proc »).
    const comparaisonBoot = comparerBootId(ligne.bootId, bootIdCourant);
    let etat: EtatRevalidationProcess;
    if (comparaisonBoot === 'boot_differe') {
      etat = 'mort_confirme';
      compteurs.mort_par_changement_de_boot += 1;
    } else if (comparaisonBoot === 'indetermine') {
      // `☠` boot_id illisible d'un côté ou de l'autre ⇒ indetermine DIRECTEMENT,
      // sans retomber sur la revalidation pid/starttime — jamais `mort_confirme`.
      etat = 'indetermine';
    } else {
      etat =
        deps.lireStarttime === undefined
          ? revaliderProcess(ligne.pid, ligne.pidStarttime)
          : revaliderProcess(ligne.pid, ligne.pidStarttime, deps.lireStarttime);
    }
    compteurs[etat] += 1;
    if (etat === 'mort_confirme') {
      // `☠` Le verdict calculé ci-dessus ne vivait qu'en mémoire jusqu'ici : la
      // colonne `vivant` d'une ligne périmée restait à 1 indéfiniment sur disque,
      // le filtre par boot_id ne rattrapant jamais un simple redémarrage de
      // SERVICE (même boot machine). Persister ICI, via le mécanisme existant,
      // ferme la cause racine de la ligne fantôme (dette n°1).
      persistance.marquerMort(ligne.sessionId);
    }

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
