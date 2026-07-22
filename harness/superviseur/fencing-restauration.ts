/**
 * Responsabilité : concurrents restaurés depuis la persistance disque (dette n°1,
 * TODO.md). Extrait de `superviseur-workers.ts` pour respecter la limite de 500
 * lignes (dette n°4a, TODO.md) — aucun changement de comportement par rapport au
 * câblage initial de la dette n°1 : ce module PORTE l'état `#liste` et les
 * opérations qui le lisent ou le modifient ; `SuperviseurWorkers` reste seul à
 * décider QUAND les appeler (fencing dans `#arbitrerFencingWorktree`, éviction
 * dans `#evincerConcurrent`).
 *
 * `☠` Un concurrent restauré n'a AUCUN handle réel : le process qu'il représente,
 * s'il existe encore, n'est PAS un enfant de cette instance du superviseur — c'est
 * exactement le problème que la dette n°1 documente. Seul recours honnête à
 * l'éviction : un `process.kill(pid, 'SIGTERM')` ciblé sur un pid numérique déjà
 * revérifié (starttime relu juste avant l'envoi, pour éviter de tuer un pid
 * recyclé entre la restauration et cette éviction) — jamais un `pkill` par motif
 * générique (leçon déjà payée : `self-fuser-kill-wrong-process`, `homelab-vm-manager`).
 */

import type { DetenteurEpoch } from './fencing-epoch.ts';
import { missionLogger, superviseurLogger } from './logger.ts';
import type { PersistanceRegistre } from './persistance-registre.ts';
import { restaurerRegistre } from './restauration-registre.ts';
import { revaliderProcess } from './revalidation-process.ts';
import type { ConcurrentRestaure } from './types.ts';

export class ConcurrentsRestaures {
  #liste: ConcurrentRestaure[] = [];

  /**
   * Restaure depuis la persistance (dette n°1, TODO.md). `☠` Volontairement PAS
   * de try/catch autour de `restaurerRegistre()` : une erreur de lecture au
   * démarrage doit arrêter le démarrage du superviseur, jamais être avalée en
   * « rien à restaurer » — ce serait le pire faux négatif possible pour cette dette
   * (un worktree réellement occupé traité comme libre).
   */
  restaurer(persistance: PersistanceRegistre): void {
    this.#liste = [...restaurerRegistre(persistance)];
    superviseurLogger.info(
      { concurrentsRestaures: this.#liste.length },
      'registre restauré et câblé sur le fencing (dette n°1, TODO.md)',
    );
  }

  /** Concurrents vivants sur un worktree donné, hors la session candidate elle-même. */
  concurrentsSur(worktree: string, sessionIdCandidat: string): readonly DetenteurEpoch[] {
    return this.#liste
      .filter((f) => f.vivant && f.worktree === worktree && f.sessionId !== sessionIdCandidat)
      .map((f) => ({ sessionId: f.sessionId, epoch: f.epoch }));
  }

  /** Vue pour `InventairePc` (B.1.4) — taire les concurrents restaurés mentirait sur ce que « le PC fait autorité » signifie après un redémarrage. */
  tous(): readonly ConcurrentRestaure[] {
    return this.#liste;
  }

  /**
   * Tente d'évincer un concurrent restauré identifié par `sessionId`+`worktree`.
   * Rend `true` si un fantôme correspondant a été trouvé (et traité, quelle que
   * soit l'issue de la terminaison réelle), `false` sinon — l'appelant sait alors
   * que la session visée n'est pas un concurrent restauré (probablement un worker
   * réel du registre en mémoire, à traiter par sa propre voie).
   */
  evincer(sessionId: string, worktree: string, terminer: (pid: number, signal: NodeJS.Signals) => void): boolean {
    const fantome = this.#liste.find((f) => f.sessionId === sessionId && f.worktree === worktree);
    if (fantome === undefined) return false;

    const log = missionLogger(fantome.missionId);
    fantome.vivant = false;

    if (fantome.pid === null || fantome.pidStarttime === null) {
      log.warn(
        { sessionId: fantome.sessionId, worktree: fantome.worktree },
        "éviction d'un concurrent restauré SANS pid connu — aucune terminaison réelle possible, vérification manuelle requise (dette n°1)",
      );
      return true;
    }

    const etatAuMomentDeLEviction = revaliderProcess(fantome.pid, fantome.pidStarttime);
    if (etatAuMomentDeLEviction !== 'vivant_confirme') {
      log.warn(
        { sessionId: fantome.sessionId, pid: fantome.pid },
        'concurrent restauré déjà disparu au moment de l’éviction — rien à terminer',
      );
      return true;
    }

    try {
      terminer(fantome.pid, 'SIGTERM');
      log.warn(
        { sessionId: fantome.sessionId, pid: fantome.pid },
        "concurrent restauré évincé : SIGTERM envoyé au pid revérifié juste avant l'envoi (dette n°1)",
      );
    } catch (erreur) {
      log.error({ err: erreur, pid: fantome.pid }, "échec de l'envoi de SIGTERM au concurrent restauré évincé");
    }
    return true;
  }
}
