/**
 * Responsabilité : persistance disque du registre de workers du PC (dette n°1,
 * TODO.md — le superviseur PC ne doit plus perdre la trace des workers vivants à
 * son propre redémarrage).
 *
 * SQLite via `bun:sqlite`, même famille technique que `control-plane/registre/`
 * (Pi, branche E) — mais JAMAIS importé d'ici : la frontière A↔B n'existe pas dans
 * un sens comme dans l'autre (voir en-tête de `registre-workers.ts`). Ce module
 * réimplémente sa propre connexion, son propre schéma, sa propre migration : aucun
 * couplage avec le registre du Pi.
 *
 * Ce que ce module fait : écrire/lire une image disque de `RegistreWorkers`. Ce
 * qu'il ne fait PAS : décider si un enregistrement relu est encore vivant — c'est
 * `restauration-registre.ts` (revalidation pid+starttime) qui en décide, jamais ce
 * fichier.
 */

import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { WorkerSpec } from '../workers/index.ts';
import { superviseurLogger } from './logger.ts';
import type { LigneRegistrePersistee } from './types.ts';

const VERSION_SCHEMA = 1;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS worker_registre (
  session_id     TEXT PRIMARY KEY,
  mission_id     TEXT NOT NULL,
  worktree       TEXT NOT NULL,
  epoch          INTEGER NOT NULL,
  pid            INTEGER,
  pid_starttime  TEXT,
  vivant         INTEGER NOT NULL CHECK (vivant IN (0, 1)),
  spec_json      TEXT NOT NULL,
  maj_a          INTEGER NOT NULL
) STRICT;

CREATE INDEX IF NOT EXISTS idx_worker_registre_worktree ON worker_registre(worktree) WHERE vivant = 1;
`;

export interface OptionsPersistanceRegistre {
  /** Chemin du fichier SQLite. `:memory:` accepté (tests). Jamais codé en dur (mission). */
  readonly chemin: string;
}

/** Ce qu'écrit un appelant — `majA` est posé par le module, jamais par l'appelant. */
export interface EnregistrementAPersister {
  readonly sessionId: string;
  readonly missionId: string;
  readonly worktree: string;
  readonly epoch: number;
  readonly pid: number | null;
  readonly pidStarttime: string | null;
  readonly vivant: boolean;
  readonly spec: WorkerSpec;
}

/** Port injecté dans `RegistreWorkers` (optionnel, défaut `null` — voir B.1.4). */
export interface PersistanceRegistre {
  sauvegarder(enregistrement: EnregistrementAPersister): void;
  marquerMort(sessionId: string): void;
  /**
   * `☠` Ne catch rien côté implémentation : un échec de lecture au démarrage doit
   * remonter à l'appelant (`restauration-registre.ts`), jamais être avalé en
   * « rien à restaurer » — ce serait le pire faux négatif possible pour cette dette.
   */
  tous(): readonly LigneRegistrePersistee[];
  fermer(): void;
}

interface LigneBrute {
  readonly session_id: string;
  readonly mission_id: string;
  readonly worktree: string;
  readonly epoch: number;
  readonly pid: number | null;
  readonly pid_starttime: string | null;
  readonly vivant: number;
  readonly spec_json: string;
  readonly maj_a: number;
}

/** Implémentation réelle du port, SQLite (WAL, un seul écrivain : ce superviseur). */
export class PersistanceRegistreSqlite implements PersistanceRegistre {
  readonly #db: Database;

  constructor(options: OptionsPersistanceRegistre) {
    if (options.chemin !== ':memory:') mkdirSync(dirname(options.chemin), { recursive: true });
    this.#db = new Database(options.chemin, { create: true });
    this.#db.run('PRAGMA journal_mode = WAL');
    this.#db.run('PRAGMA busy_timeout = 5000');
    this.#db.run(`PRAGMA user_version = ${VERSION_SCHEMA}`);
    this.#db.run(SCHEMA);
  }

  /** Écriture à chaque `enregistrer`/`remplacer` de `RegistreWorkers` (résolution de la mission). */
  sauvegarder(enregistrement: EnregistrementAPersister): void {
    try {
      this.#db
        .query(
          `INSERT INTO worker_registre
             (session_id, mission_id, worktree, epoch, pid, pid_starttime, vivant, spec_json, maj_a)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(session_id) DO UPDATE SET
             mission_id = excluded.mission_id, worktree = excluded.worktree, epoch = excluded.epoch,
             pid = excluded.pid, pid_starttime = excluded.pid_starttime, vivant = excluded.vivant,
             spec_json = excluded.spec_json, maj_a = excluded.maj_a`,
        )
        .run(
          enregistrement.sessionId,
          enregistrement.missionId,
          enregistrement.worktree,
          enregistrement.epoch,
          enregistrement.pid,
          enregistrement.pidStarttime,
          enregistrement.vivant ? 1 : 0,
          JSON.stringify(enregistrement.spec),
          Date.now(),
        );
    } catch (erreur) {
      // ☠ Best-effort assumé ici, PAS à la lecture : perdre UNE écriture de mise à
      // jour laisse au pire une image légèrement périmée (déjà couverte par la
      // revalidation pid+starttime) ; perdre la capacité de LIRE au démarrage, elle,
      // ne doit jamais être avalée (voir `tous()`).
      superviseurLogger.error({ err: erreur, sessionId: enregistrement.sessionId }, 'persistance du registre en échec (sauvegarder)');
    }
  }

  /** Écriture à chaque `marquerMort` de `RegistreWorkers` (résolution de la mission). */
  marquerMort(sessionId: string): void {
    try {
      this.#db.query('UPDATE worker_registre SET vivant = 0, maj_a = ? WHERE session_id = ?').run(Date.now(), sessionId);
    } catch (erreur) {
      superviseurLogger.error({ err: erreur, sessionId }, 'persistance du registre en échec (marquerMort)');
    }
  }

  tous(): readonly LigneRegistrePersistee[] {
    const lignes = this.#db.query<LigneBrute, []>('SELECT * FROM worker_registre').all();
    return lignes.map((ligne) => ({
      sessionId: ligne.session_id,
      missionId: ligne.mission_id,
      worktree: ligne.worktree,
      epoch: ligne.epoch,
      pid: ligne.pid,
      pidStarttime: ligne.pid_starttime,
      vivant: ligne.vivant === 1,
      spec: JSON.parse(ligne.spec_json) as WorkerSpec,
      majA: ligne.maj_a,
    }));
  }

  fermer(): void {
    this.#db.close(false);
  }
}
