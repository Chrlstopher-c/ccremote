/**
 * Responsabilité : versionnage et application du schéma SQLite d'apprentissage (E1).
 * Autorité de version : `PRAGMA user_version`, sur le modèle exact de
 * `control-plane/registre/migrations.ts`. `migration_appliquee` n'est qu'une trace
 * d'audit — elle ne décide de rien.
 *
 * Conception inspirée de Hermes Agent (Nous Research) — MIT. Transposition indépendante en TypeScript.
 */

import type { Database } from 'bun:sqlite';
import { executer, journal } from '../logger.ts';

export interface Migration {
  readonly version: number;
  readonly nom: string;
  readonly sql: string;
}

/**
 * Migration 1 — schéma initial (SPEC-APPRENTISSAGE.md §5.7).
 *
 * `☠` `passe_apprentissage` est la clé d'idempotence (spec §5.7) : sans elle, une
 * relance du superviseur retraiterait la même mission et gonflerait les compteurs
 * de confirmation avec la même observation. `mission_id` en clé primaire ferme ce
 * défaut structurellement, pas par une précaution d'appelant.
 *
 * `☠` Aucune suppression n'est jamais faite sur `lecon` : le cycle de vie passe par
 * l'état `obsolete`, jamais par un `DELETE` (SPEC §5, C-4).
 */
const MIGRATION_1 = `
CREATE TABLE lecon (
  id TEXT PRIMARY KEY,
  projet TEXT NOT NULL,
  machine TEXT,
  enonce TEXT NOT NULL,
  categorie TEXT NOT NULL CHECK (categorie IN ('outil', 'projet', 'methode', 'piege')),
  portee TEXT NOT NULL CHECK (portee IN ('projet', 'machine', 'global')),
  etat TEXT NOT NULL CHECK (etat IN ('candidate', 'active', 'dormante', 'obsolete')),
  confirmations INTEGER NOT NULL DEFAULT 1,
  contradictions INTEGER NOT NULL DEFAULT 0,
  creee_a INTEGER NOT NULL,
  derniere_confirmation_a INTEGER NOT NULL,
  servie_count INTEGER NOT NULL DEFAULT 0
) STRICT;

CREATE INDEX idx_lecon_projet_etat ON lecon(projet, etat);

CREATE TABLE lecon_observation (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lecon_id TEXT NOT NULL REFERENCES lecon(id),
  mission_id TEXT NOT NULL,
  sens TEXT NOT NULL CHECK (sens IN ('confirme', 'contredit')),
  preuve TEXT NOT NULL,
  observee_a INTEGER NOT NULL
) STRICT;

CREATE INDEX idx_lecon_observation_lecon ON lecon_observation(lecon_id, observee_a);

CREATE TABLE passe_apprentissage (
  mission_id TEXT PRIMARY KEY,
  traitee_a INTEGER NOT NULL,
  issue TEXT NOT NULL,
  lecons_extraites INTEGER NOT NULL,
  erreur TEXT
) STRICT;

CREATE TABLE migration_appliquee (
  version    INTEGER PRIMARY KEY,
  nom        TEXT NOT NULL,
  applique_a INTEGER NOT NULL
) STRICT;
`;

/**
 * Migration 2 (E10) — horloge de la consolidation périodique (C-4, PLAN-PORTAGE.md E10).
 * Une ligne unique (`id = 1`, forcé par CHECK) : la date de la dernière passe exécutée (ou
 * semée — SPEC §5, C-4 : « première observation : on sème l'horodatage et on diffère d'un
 * intervalle complet »). Ne PORTE aucune décision de suppression : cette table ne fait que
 * dater, elle ne touche jamais à `lecon`.
 */
const MIGRATION_2 = `
CREATE TABLE consolidation_etat (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  derniere_passe_a INTEGER NOT NULL
) STRICT;
`;

export const MIGRATIONS: readonly Migration[] = [
  { version: 1, nom: 'schema-initial', sql: MIGRATION_1 },
  { version: 2, nom: 'horloge-consolidation', sql: MIGRATION_2 },
] as const;

export const VERSION_SCHEMA_CIBLE: number = MIGRATIONS.reduce(
  (max, m) => (m.version > max ? m.version : max),
  0,
);

export function versionSchema(db: Database): number {
  return executer('versionSchema', () => {
    const ligne = db.query<{ user_version: number }, []>('PRAGMA user_version').get();
    return ligne?.user_version ?? 0;
  });
}

/** Applique toutes les migrations manquantes, chacune dans sa propre transaction. Idempotent. */
export function migrer(db: Database): number {
  const depart = versionSchema(db);
  for (const migration of MIGRATIONS) {
    if (migration.version <= depart) continue;
    appliquer(db, migration);
  }
  const arrivee = versionSchema(db);
  if (arrivee !== depart) {
    journal.info({ depart, arrivee }, 'schéma d’apprentissage migré');
  }
  return arrivee;
}

function appliquer(db: Database, migration: Migration): void {
  executer(
    `migration:${migration.version}`,
    () => {
      db.transaction(() => {
        db.run(migration.sql);
        db
          .query('INSERT INTO migration_appliquee (version, nom, applique_a) VALUES (?, ?, ?)')
          .run(migration.version, migration.nom, Date.now());
        db.run(`PRAGMA user_version = ${migration.version}`);
      })();
    },
    { nom: migration.nom },
  );
}
