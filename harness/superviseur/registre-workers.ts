/**
 * Responsabilité : registre EN MÉMOIRE des workers du PC (branche B, D.3).
 *
 * Aucune I/O ici — pure structure de données, testable sans SDK. Le PC fait
 * autorité sur ce qui tourne (B.1.4, H-15) : ce registre EST cette autorité, il ne
 * la lit nulle part ailleurs. Distinct du registre SQLite du Pi (`control-plane/
 * registre/`, branche E) — jamais importé ici, la frontière A↔B n'existe pas
 * (03-couche-1.md) et ce module ne la traverse donc pas non plus dans l'autre sens.
 *
 * Deux index tenus en parallèle : par `sessionId` (identité SDK, utilisée par
 * `InventairePc`/`ReinitialisateurSession`) et par `missionId` (identité métier,
 * utilisée par `RepertoireCibles`/`ArreteurMission`/`RelanceurMission`). Un worker
 * mort reste en mémoire (jamais purgé automatiquement) : c'est ce qui permet à la
 * relance (`RelanceurMission`) de retrouver le dernier `WorkerSpec` connu après la
 * mort du process.
 *
 * **Persistance optionnelle** (dette n°1, TODO.md) : un port `PersistanceRegistre`
 * peut être injecté, `null` par défaut. Tous les appels existants et les tests
 * existants continuent de passer sans modification — c'est un ajout strictement
 * additif. Quand présent, chaque `enregistrer`/`marquerMort`/`remplacer` écrit
 * aussi sur disque ; c'est `restaurerRegistre()` (`restauration-registre.ts`) qui
 * relit cette image au démarrage, jamais ce module directement.
 */

import type { PersistanceRegistre } from './persistance-registre.ts';
import type { EnregistrementWorker } from './types.ts';

export class RegistreWorkers {
  readonly #parSession = new Map<string, EnregistrementWorker>();
  readonly #sessionParMission = new Map<string, string>();
  readonly #persistance: PersistanceRegistre | null;

  constructor(persistance: PersistanceRegistre | null = null) {
    this.#persistance = persistance;
  }

  enregistrer(enregistrement: EnregistrementWorker): void {
    this.#parSession.set(enregistrement.sessionId, enregistrement);
    this.#sessionParMission.set(enregistrement.missionId, enregistrement.sessionId);
    this.#persister(enregistrement);
  }

  parSession(sessionId: string): EnregistrementWorker | null {
    return this.#parSession.get(sessionId) ?? null;
  }

  parMission(missionId: string): EnregistrementWorker | null {
    const sessionId = this.#sessionParMission.get(missionId);
    if (sessionId === undefined) return null;
    return this.parSession(sessionId);
  }

  /** Marque le worker mort. `☠` Ne retire jamais l'enregistrement (relance, historique). */
  marquerMort(sessionId: string): void {
    const enregistrement = this.#parSession.get(sessionId);
    if (enregistrement === undefined) return;
    enregistrement.vivant = false;
    this.#persistance?.marquerMort(sessionId);
  }

  /**
   * Remplace l'enregistrement d'une mission par un nouveau worker (relance,
   * B.3.3) : le `sessionId` SDK est identique (`resume`), seule la poignée de
   * process change. L'ancien enregistrement mort reste accessible par son
   * `sessionId` si quelque chose y référait encore — ce remplacement ne fait
   * que réindexer `missionId` vers le nouvel enregistrement vivant.
   */
  remplacer(enregistrement: EnregistrementWorker): void {
    this.enregistrer(enregistrement);
  }

  /** Vue autoritaire (B.1.4) — utilisée par `InventairePc.inventaire()`. */
  tous(): readonly EnregistrementWorker[] {
    return [...this.#parSession.values()];
  }

  /**
   * Écrit à travers vers la persistance (best-effort, dette n°1) : une erreur ici
   * est journalisée par `PersistanceRegistre` lui-même et n'interrompt jamais le
   * chemin en mémoire, qui reste la source de vérité pour ce process en vie.
   */
  #persister(enregistrement: EnregistrementWorker): void {
    this.#persistance?.sauvegarder({
      sessionId: enregistrement.sessionId,
      missionId: enregistrement.missionId,
      worktree: enregistrement.worktree,
      epoch: enregistrement.epoch,
      pid: enregistrement.pid ?? null,
      pidStarttime: enregistrement.pidStarttime ?? null,
      vivant: enregistrement.vivant,
      spec: enregistrement.spec,
    });
  }
}
