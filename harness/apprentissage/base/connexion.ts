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
import { mkdirSync, statSync } from 'node:fs';
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

/**
 * Erreur dédiée à l'ouverture en lecture seule d'une base jamais initialisée. `☠` Distincte
 * de `ErreurApprentissage` : ce n'est PAS une panne (aucune écriture n'a encore eu lieu au
 * premier démarrage du système), donc jamais journalisée en erreur — voir `ouvrirBaseApprentissage`.
 */
export class ErreurBaseAbsente extends Error {
  constructor(chemin: string) {
    super(`base d’apprentissage absente (jamais initialisée) : ${chemin}`);
    this.name = 'ErreurBaseAbsente';
  }
}

/**
 * Ouvre la base et garantit que le schéma est à jour. En lecture seule, aucune migration.
 * En écriture, le dossier ET le fichier sont créés s'ils n'existent pas encore — le premier
 * mandat construit après l'allumage du système est l'occasion normale de cette création.
 * En lecture seule sur une base absente : lève `ErreurBaseAbsente` SANS journaliser d'erreur —
 * une base vide au premier démarrage est l'état NORMAL, pas une panne (voir `composerBlocLecons`,
 * qui traite ce cas comme « zéro leçon »). Le journal d'erreur reste réservé aux vraies pannes :
 * base corrompue, droits refusés — celles-ci passent toujours par `executer` plus bas.
 */
export function ouvrirBaseApprentissage(options: OptionsConnexionApprentissage = {}): Database {
  const chemin = options.chemin ?? cheminBaseParDefaut();
  const lectureSeule = options.lectureSeule ?? false;
  if (lectureSeule && estFichierAbsent(chemin)) {
    throw new ErreurBaseAbsente(chemin);
  }
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

/**
 * Vrai seulement si le fichier n'existe pas (ENOENT) — les autres pannes de `stat` (droits
 * refusés, dossier parent absent…) sont de vraies pannes et doivent remonter jusqu'à
 * `executer` pour être journalisées en erreur, pas absorbées ici.
 */
function estFichierAbsent(chemin: string): boolean {
  if (chemin === ':memory:' || chemin.startsWith('file::memory:')) return false;
  try {
    statSync(chemin);
    return false;
  } catch (erreur) {
    return estErreurFichierAbsent(erreur);
  }
}

// Cast justifié : Node ne type pas nativement les erreurs `fs` — `code` est le seul moyen
// standard de distinguer ENOENT (fichier absent, normal) d'une vraie panne (droits refusés).
function estErreurFichierAbsent(erreur: unknown): boolean {
  return (
    typeof erreur === 'object' &&
    erreur !== null &&
    'code' in erreur &&
    (erreur as { code?: unknown }).code === 'ENOENT'
  );
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
