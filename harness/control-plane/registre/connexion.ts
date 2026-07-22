/**
 * Responsabilité : ouverture/fermeture de la base SQLite du registre (H-21).
 * Un seul écrivain (le control plane), lectures concurrentes via WAL.
 */

import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { executer, journal } from './journal.ts';
import { migrer } from './migrations.ts';

export interface OptionsConnexion {
  /** Chemin du fichier SQLite. `:memory:` accepté pour les tests. */
  readonly chemin: string;
  /** Ouvre en lecture seule : pour les lecteurs concurrents (UI, API). */
  readonly lectureSeule?: boolean;
  /** Délai d'attente sur verrou, ms. Défaut 5000. */
  readonly attenteVerrouMs?: number;
}

const ATTENTE_VERROU_MS_DEFAUT = 5000;

/**
 * Ouvre la base et garantit que le schéma est à jour.
 * En lecture seule, aucune migration n'est appliquée : le seul écrivain migre.
 */
export function ouvrirBase(options: OptionsConnexion): Database {
  const { chemin, lectureSeule = false } = options;
  return executer(
    'ouvrirBase',
    () => {
      if (!lectureSeule) preparerRepertoire(chemin);
      const db = new Database(chemin, lectureSeule ? { readonly: true } : { create: true });
      appliquerPragmas(db, options);
      if (!lectureSeule) migrer(db);
      journal.debug({ chemin, lectureSeule }, 'base du registre ouverte');
      return db;
    },
    { chemin, lectureSeule },
  );
}

function preparerRepertoire(chemin: string): void {
  if (chemin === ':memory:' || chemin.startsWith('file::memory:')) return;
  mkdirSync(dirname(chemin), { recursive: true });
}

function appliquerPragmas(db: Database, options: OptionsConnexion): void {
  const attente = options.attenteVerrouMs ?? ATTENTE_VERROU_MS_DEFAUT;
  // WAL : un écrivain + N lecteurs sans blocage mutuel. Non applicable en mémoire.
  if (!options.lectureSeule) {
    db.run('PRAGMA journal_mode = WAL');
    db.run('PRAGMA synchronous = NORMAL');
  }
  db.run('PRAGMA foreign_keys = ON');
  db.run(`PRAGMA busy_timeout = ${attente}`);
}

export function fermerBase(db: Database): void {
  executer('fermerBase', () => {
    db.close(false);
  });
}
