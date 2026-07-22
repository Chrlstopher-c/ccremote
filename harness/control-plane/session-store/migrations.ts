/**
 * Responsabilité : schéma SQLite du miroir de transcripts (E.3, mission M-31).
 * Même patron de versionnage que `control-plane/registre/migrations.ts` :
 * `PRAGMA user_version` fait autorité, `migration_appliquee` n'est qu'une trace.
 */

import type { Database } from 'bun:sqlite';
import { executer, journal } from './journal.ts';

export interface Migration {
  readonly version: number;
  readonly nom: string;
  readonly sql: string;
}

/**
 * Migration 1 — schéma initial du miroir.
 *
 * Quatre décisions portées par le schéma, pas par le code appelant :
 *
 * 1. `session_entree` a une clé primaire `id AUTOINCREMENT` qui fait office d'ordre
 *    d'arrivée (E.3.1 : « dans un même processus, persister dans l'ordre des appels »).
 *    Un upsert par `uuid` met à jour la ligne existante SANS changer son `id` — l'ordre
 *    chronologique d'origine est donc préservé même après réécriture (E.3.2).
 * 2. `idx_session_entree_idempotence` est un index unique PARTIEL sur les entrées qui
 *    portent un `uuid` (E.3.2). Les entrées sans `uuid` (titres, tags, marqueurs de mode)
 *    ne sont jamais dédupliquées — elles ne sont pas couvertes par cet index.
 * 3. `session_sommaire` est le sidecar de `foldSessionSummary` (H.3.2, ⚠ ALPHA côté SDK).
 *    `mtime` est une colonne à part, jamais dérivée du contenu JSON : c'est ce qui permet
 *    de l'estampiller avec l'horloge du store plutôt qu'avec les horodatages d'entrées
 *    (panne #31 de la grille de revue). `donnee` est le blob opaque du SDK, persisté
 *    verbatim, jamais interprété ici.
 * 4. `session_defaillance` est la pièce qui rend une divergence miroir/vérité détectable
 *    (principe directeur de la mission) : chaque échec d'`append` y laisse une trace
 *    durable, indépendante du message `mirror_error` que le SDK émet dans le flux de
 *    la session — un flux qui peut lui-même être perdu si le consommateur crashe avant
 *    de le traiter. `emetteur` sur `session_entree` est réservée pour H-66 (attribution
 *    de l'émetteur) : NULL en v1, colonne posée maintenant pour éviter une migration
 *    séparée quand M-30/A la peupleront — conformément à la note explicite de REPRISE.md.
 */
const MIGRATION_1 = `
CREATE TABLE session_entree (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  project_key TEXT NOT NULL,
  session_id  TEXT NOT NULL,
  subpath     TEXT NOT NULL DEFAULT '',
  uuid        TEXT,
  type        TEXT NOT NULL,
  emetteur    TEXT,
  donnee      TEXT NOT NULL,
  ecrit_a     INTEGER NOT NULL
) STRICT;

CREATE UNIQUE INDEX idx_session_entree_idempotence
  ON session_entree(project_key, session_id, subpath, uuid)
  WHERE uuid IS NOT NULL;

CREATE INDEX idx_session_entree_lecture
  ON session_entree(project_key, session_id, subpath, id);

CREATE TABLE session_sommaire (
  project_key TEXT NOT NULL,
  session_id  TEXT NOT NULL,
  mtime       INTEGER NOT NULL,
  donnee      TEXT NOT NULL,
  PRIMARY KEY (project_key, session_id)
) STRICT;

CREATE INDEX idx_session_sommaire_projet ON session_sommaire(project_key, mtime DESC);

CREATE TABLE session_defaillance (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  project_key TEXT NOT NULL,
  session_id  TEXT NOT NULL,
  subpath     TEXT NOT NULL DEFAULT '',
  cause       TEXT NOT NULL,
  survenu_a   INTEGER NOT NULL
) STRICT;

CREATE INDEX idx_session_defaillance_cle
  ON session_defaillance(project_key, session_id, subpath, survenu_a DESC);

CREATE TABLE migration_appliquee (
  version    INTEGER PRIMARY KEY,
  nom        TEXT NOT NULL,
  applique_a INTEGER NOT NULL
) STRICT;
`;

export const MIGRATIONS: readonly Migration[] = [
  { version: 1, nom: 'schema-initial-session-store', sql: MIGRATION_1 },
] as const;

export const VERSION_SCHEMA_STORE_CIBLE: number = MIGRATIONS.reduce(
  (max, m) => (m.version > max ? m.version : max),
  0,
);

export function versionSchemaStore(db: Database): number {
  return executer('versionSchemaStore', () => {
    const ligne = db.query<{ user_version: number }, []>('PRAGMA user_version').get();
    return ligne?.user_version ?? 0;
  });
}

/** Applique toutes les migrations manquantes, chacune dans sa propre transaction. */
export function migrer(db: Database): number {
  const depart = versionSchemaStore(db);
  for (const migration of MIGRATIONS) {
    if (migration.version <= depart) continue;
    appliquer(db, migration);
  }
  const arrivee = versionSchemaStore(db);
  if (arrivee !== depart) {
    journal.info({ depart, arrivee }, 'schéma session-store migré');
  }
  return arrivee;
}

function appliquer(db: Database, migration: Migration): void {
  executer(
    `migration-store:${migration.version}`,
    () => {
      db.transaction(() => {
        db.run(migration.sql);
        db.query(
          'INSERT INTO migration_appliquee (version, nom, applique_a) VALUES (?, ?, ?)',
        ).run(migration.version, migration.nom, Date.now());
        db.run(`PRAGMA user_version = ${migration.version}`);
      })();
    },
    { nom: migration.nom },
  );
}
