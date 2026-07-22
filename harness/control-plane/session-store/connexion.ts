/**
 * Responsabilité : ouverture/fermeture de la base SQLite du store de sessions (H-21, E.3.4).
 *
 * Fichier séparé de `control-plane/registre/` par conception : le registre (E.1, missions,
 * lots, comptes) et le miroir de transcripts (E.3) sont deux responsabilités uniques
 * distinctes qui ne partagent ni schéma ni cycle de vie. Ajouter l'un ne doit modifier
 * aucune ligne de l'autre (critère de modularité de `03-couche-1.md`).
 */

import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { executer, journal } from './journal.ts';
import { migrer } from './migrations.ts';

export interface OptionsConnexionStore {
  /** Chemin du fichier SQLite. `:memory:` accepté pour les tests. */
  readonly chemin: string;
  /** Ouvre en lecture seule : pour les lecteurs concurrents (UI, réconciliation). */
  readonly lectureSeule?: boolean;
  /** Délai d'attente sur verrou, ms. Défaut 5000. */
  readonly attenteVerrouMs?: number;
}

const ATTENTE_VERROU_MS_DEFAUT = 5000;

/** Ouvre la base et garantit que le schéma est à jour. */
export function ouvrirBaseStore(options: OptionsConnexionStore): Database {
  const { chemin, lectureSeule = false } = options;
  return executer(
    'ouvrirBaseStore',
    () => {
      if (!lectureSeule) preparerRepertoire(chemin);
      const db = new Database(chemin, lectureSeule ? { readonly: true } : { create: true });
      appliquerPragmas(db, options);
      if (!lectureSeule) migrer(db);
      journal.debug({ chemin, lectureSeule }, 'base session-store ouverte');
      return db;
    },
    { chemin, lectureSeule },
  );
}

function preparerRepertoire(chemin: string): void {
  if (chemin === ':memory:' || chemin.startsWith('file::memory:')) return;
  mkdirSync(dirname(chemin), { recursive: true });
}

function appliquerPragmas(db: Database, options: OptionsConnexionStore): void {
  const attente = options.attenteVerrouMs ?? ATTENTE_VERROU_MS_DEFAUT;
  // WAL : un écrivain + N lecteurs sans blocage mutuel (H-21). Non applicable en mémoire.
  if (!options.lectureSeule) {
    db.run('PRAGMA journal_mode = WAL');
    db.run('PRAGMA synchronous = NORMAL');
  }
  db.run('PRAGMA foreign_keys = ON');
  db.run(`PRAGMA busy_timeout = ${attente}`);
}

export function fermerBaseStore(db: Database): void {
  executer('fermerBaseStore', () => {
    db.close(false);
  });
}
