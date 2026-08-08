/**
 * Responsabilité : ouverture/fermeture de la base SQLite d'apprentissage (E1).
 * Un seul écrivain — le harness, après la mort d'une session (SPEC §1) — et des
 * lecteurs concurrents via WAL, mêmes PRAGMA que `control-plane/registre/connexion.ts`
 * et `control-plane/session-store/connexion.ts` : un écrivain concurrent existe déjà
 * sur cette machine, on ne réinvente pas une seconde politique de verrouillage.
 *
 * Conception inspirée de Hermes Agent (Nous Research) — MIT. Transposition indépendante en TypeScript.
 */

import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { executer, journal } from '../logger.ts';
import { migrer } from './migrations.ts';

export interface OptionsConnexionApprentissage {
  /** Chemin du fichier SQLite. Défaut : `CCREMOTE_APPRENTISSAGE_DB` ou le repli standard. */
  readonly chemin?: string;
  /** Ouvre en lecture seule : pour les lecteurs concurrents (réinjection C-6). */
  readonly lectureSeule?: boolean;
  /** Délai d'attente sur verrou, ms. Défaut 5000. */
  readonly attenteVerrouMs?: number;
}

const ATTENTE_VERROU_MS_DEFAUT = 5000;

/** `CCREMOTE_APPRENTISSAGE_DB`, repli `~/.local/share/ccremote/apprentissage.db` (SPEC E1). */
export function cheminBaseParDefaut(): string {
  const depuisEnv = process.env['CCREMOTE_APPRENTISSAGE_DB'];
  if (depuisEnv !== undefined && depuisEnv.length > 0) return depuisEnv;
  return join(homedir(), '.local', 'share', 'ccremote', 'apprentissage.db');
}

/** Ouvre la base et garantit que le schéma est à jour. En lecture seule, aucune migration. */
export function ouvrirBaseApprentissage(options: OptionsConnexionApprentissage = {}): Database {
  const chemin = options.chemin ?? cheminBaseParDefaut();
  const lectureSeule = options.lectureSeule ?? false;
  return executer(
    'ouvrirBaseApprentissage',
    () => {
      if (!lectureSeule) preparerRepertoire(chemin);
      const db = new Database(chemin, lectureSeule ? { readonly: true } : { create: true });
      appliquerPragmas(db, { lectureSeule, attenteVerrouMs: options.attenteVerrouMs });
      if (!lectureSeule) migrer(db);
      journal.debug({ chemin, lectureSeule }, 'base d’apprentissage ouverte');
      return db;
    },
    { chemin, lectureSeule },
  );
}

function preparerRepertoire(chemin: string): void {
  if (chemin === ':memory:' || chemin.startsWith('file::memory:')) return;
  mkdirSync(dirname(chemin), { recursive: true });
}

function appliquerPragmas(
  db: Database,
  options: { readonly lectureSeule: boolean; readonly attenteVerrouMs?: number },
): void {
  const attente = options.attenteVerrouMs ?? ATTENTE_VERROU_MS_DEFAUT;
  if (!options.lectureSeule) {
    db.run('PRAGMA journal_mode = WAL');
    db.run('PRAGMA synchronous = NORMAL');
  }
  db.run('PRAGMA foreign_keys = ON');
  db.run(`PRAGMA busy_timeout = ${attente}`);
}

export function fermerBaseApprentissage(db: Database): void {
  executer('fermerBaseApprentissage', () => {
    db.close(false);
  });
}
