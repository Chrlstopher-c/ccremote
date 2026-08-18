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

/**
 * Version 1 — schéma initial (pid/starttime uniquement). Version 2 (H-75)
 * ajoute `boot_id` par `ALTER TABLE`, jamais par recréation de table : un
 * fichier écrit par la version 1 doit migrer SANS perdre une seule ligne.
 */
const MIGRATION_1_SQL = `
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

/**
 * Migration 2 (H-75) : `boot_id` — identité du boot Linux au moment de
 * l'écriture (`identite-boot.ts`), posée par `RegistreWorkers` à chaque
 * enregistrement. `ADD COLUMN` nullable, sans défaut : une ligne écrite AVANT
 * cette migration se relit avec `boot_id = NULL`. C'est volontaire — voir
 * `tous()` et le commentaire sur `LigneRegistrePersistee.bootId` (`types.ts`) :
 * `restauration-registre.ts` traite ce NULL comme « illisible » ⇒
 * `indetermine`, jamais `mort_confirme` (biais asymétrique de la dette n°1).
 */
const MIGRATION_2_SQL = `ALTER TABLE worker_registre ADD COLUMN boot_id TEXT;`;

/** Autorité de version : `PRAGMA user_version`, jamais une table à part (même motif que `control-plane/registre/migrations.ts`, non importé). */
function versionSchema(db: Database): number {
  const ligne = db.query<{ user_version: number }, []>('PRAGMA user_version').get();
  return ligne?.user_version ?? 0;
}

/**
 * Applique les migrations manquantes, dans l'ordre, chacune dans sa propre
 * transaction. `☠` Ne recrée jamais `worker_registre` : toute évolution future
 * de ce schéma doit passer par `ALTER TABLE`/nouvelle colonne, jamais un
 * `DROP`/`CREATE`, pour ne jamais perdre une ligne déjà écrite.
 */
function migrer(db: Database): void {
  if (versionSchema(db) < 1) {
    db.transaction(() => {
      db.run(MIGRATION_1_SQL);
      db.run('PRAGMA user_version = 1');
    })();
  }
  if (versionSchema(db) < 2) {
    db.transaction(() => {
      db.run(MIGRATION_2_SQL);
      db.run('PRAGMA user_version = 2');
    })();
  }
}

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
  /**
   * Identité du boot Linux au moment de l'écriture (H-75) — `null` si
   * `identite-boot.ts` n'a rien pu lire. Optionnel (et non `undefined` traité
   * comme `null`) pour ne pas casser un appelant hors `superviseur/` qui
   * n'aurait pas encore ce champ — voir `sauvegarder()`.
   */
  readonly bootId?: string | null;
  readonly vivant: boolean;
  readonly spec: WorkerSpec;
}


/**
 * `☠` Ce qui SURVIT réellement à la persistance. `WorkerSpec` porte des **ports**
 * — `portAuditPermissions`, `portBusPermissions`, `sessionStore`, `spawnProcess`,
 * `onStderr` — qui sont des **fonctions** : `JSON.stringify` les efface sans rien
 * signaler. Une spec relue depuis le disque n'a donc plus aucun de ses garde-fous.
 *
 * Le type le dit désormais explicitement, au lieu de laisser croire à un
 * `WorkerSpec` complet : relancer un worker depuis une spec restaurée **sans
 * réinjecter les ports** produirait un worker sans audit et sans arbitrage de
 * permissions — une extinction silencieuse de garde-fous (H-74), par le seul
 * fait d'un redémarrage.
 *
 * `☠` `mcpServers` (H-76, panne du 18/08 20h19) n'est PAS de la même famille que
 * les ports ci-dessus : ce n'est pas une fonction que `JSON.stringify` efface
 * silencieusement, c'est un objet — potentiellement une INSTANCE `McpServer` du
 * SDK (`McpSdkServerConfigWithInstance.instance`, rendue par
 * `createSdkMcpServer()`) porteuse de références circulaires, qui fait LEVER
 * `JSON.stringify` (`TypeError: cyclic structures`). `construire-worker-spec.ts`
 * en place une dans chaque `WorkerSpec` de production (`ccremote-depense`). Ce
 * champ est donc remplacé ici par une trace minimale et TOUJOURS sérialisable
 * (voir `McpServeurPersiste`) — jamais l'objet d'origine.
 *
 * ⇒ La restauration rend des **données**. Les ports sont réinjectés par la
 * composition (`composition/pc/`), jamais relus du disque.
 */
export type WorkerSpecPersistee = Omit<
  WorkerSpec,
  'portAuditPermissions' | 'portBusPermissions' | 'sessionStore' | 'spawnProcess' | 'onStderr' | 'mcpServers'
> & {
  readonly mcpServers: Readonly<Record<string, McpServeurPersiste>>;
};

/**
 * Trace persistée d'UN serveur MCP — nom (clé du record) et type de transport
 * seulement, jamais la configuration complète ni l'instance (H-76). Suffisant
 * pour la restauration : `restauration-registre.ts` ne relance JAMAIS un worker
 * depuis une spec relue, elle sert uniquement de trace pour le fencing et le
 * diagnostic (`ConcurrentRestaure.spec`) — savoir QUELS serveurs un worker avait
 * lui suffit, pas les reconstruire.
 */
export interface McpServeurPersiste {
  readonly type: string;
}

/**
 * Projette `mcpServers` vers une forme TOUJOURS sérialisable. `☠` Ne fait
 * confiance à AUCUNE variante du SDK : même les transports aujourd'hui plats
 * (`stdio`/`sse`/`http`) ne sont retenus que par leur `type` — si l'un d'eux
 * gagnait un jour un champ fonction ou instance, cette projection resterait
 * sûre, elle ne recopie jamais la configuration entière.
 */
function projeterMcpServeurs(mcpServers: WorkerSpec['mcpServers']): Readonly<Record<string, McpServeurPersiste>> {
  const projection: Record<string, McpServeurPersiste> = {};
  for (const [nom, config] of Object.entries(mcpServers)) {
    projection[nom] = { type: config.type ?? 'stdio' };
  }
  return projection;
}

/**
 * Construit RÉELLEMENT ce qui part sur disque, à l'exécution — l'idiome déjà en
 * place pour les ports-fonctions (`WorkerSpecPersistee`), rendu effectif.
 *
 * `☠` `WorkerSpecPersistee` seul n'avait AUCUN effet à l'exécution : rien ne
 * projetait `enregistrement.spec` dessus avant `sauvegarder()` appelait
 * `JSON.stringify(enregistrement.spec)` tel quel, en confiant à `JSON.stringify`
 * lui-même l'effacement des fonctions — silencieux pour une fonction, mais une
 * `TypeError` non catchée pour un objet cyclique comme `mcpServers` (H-76). Cette
 * fonction est désormais le SEUL point qui construit la projection persistée :
 * toute nouvelle instance non sérialisable ajoutée à `WorkerSpec` doit être
 * traitée ICI, explicitement, jamais laissée à la sérialisation par défaut.
 */
function projeterSpecPersistee(spec: WorkerSpec): WorkerSpecPersistee {
  const {
    portAuditPermissions: _portAuditPermissions,
    sessionStore: _sessionStore,
    spawnProcess: _spawnProcess,
    onStderr: _onStderr,
    mcpServers,
    ...donnees
  } = spec;
  return { ...donnees, mcpServers: projeterMcpServeurs(mcpServers) };
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
  /** `NULL` pour toute ligne écrite avant la migration 2 (H-75) — voir `MIGRATION_2_SQL`. */
  readonly boot_id: string | null;
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
    migrer(this.#db);
  }

  /** Écriture à chaque `enregistrer`/`remplacer` de `RegistreWorkers` (résolution de la mission). */
  sauvegarder(enregistrement: EnregistrementAPersister): void {
    try {
      this.#db
        .query(
          `INSERT INTO worker_registre
             (session_id, mission_id, worktree, epoch, pid, pid_starttime, boot_id, vivant, spec_json, maj_a)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(session_id) DO UPDATE SET
             mission_id = excluded.mission_id, worktree = excluded.worktree, epoch = excluded.epoch,
             pid = excluded.pid, pid_starttime = excluded.pid_starttime, boot_id = excluded.boot_id,
             vivant = excluded.vivant, spec_json = excluded.spec_json, maj_a = excluded.maj_a`,
        )
        .run(
          enregistrement.sessionId,
          enregistrement.missionId,
          enregistrement.worktree,
          enregistrement.epoch,
          enregistrement.pid,
          enregistrement.pidStarttime,
          enregistrement.bootId ?? null,
          enregistrement.vivant ? 1 : 0,
          JSON.stringify(projeterSpecPersistee(enregistrement.spec)),
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
      bootId: ligne.boot_id,
      vivant: ligne.vivant === 1,
      // ☠ Jamais `as WorkerSpec` : les ports ont été effacés par la sérialisation.
      spec: JSON.parse(ligne.spec_json) as WorkerSpecPersistee,
      majA: ligne.maj_a,
    }));
  }

  fermer(): void {
    this.#db.close(false);
  }
}
