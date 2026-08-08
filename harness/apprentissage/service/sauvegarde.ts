/**
 * Responsabilité : sauvegarder `apprentissage.db` et le dossier `competences/` AVANT toute
 * passe mutante (C-4, SPEC §5 `☠`, réduction de H-9) — une copie de fichiers, jamais une
 * archive à construire. `☠` Prise AVANT la passe, jamais après : une passe ratée ne doit
 * jamais partir d'un état qu'on ne peut pas restaurer (PLAN-PORTAGE.md E10 `☠`).
 *
 * Conception inspirée de Hermes Agent (Nous Research) — MIT. Transposition indépendante en TypeScript.
 */

import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { executer, journal } from '../logger.ts';

/** SPEC §5, C-4 `☠` : 5 sauvegardes conservées, jamais plus. */
export const MAX_SAUVEGARDES_CONSERVEES = 5;

/** `CCREMOTE_APPRENTISSAGE_DIR`, repli `~/.local/share/ccremote/apprentissage` (racine des sauvegardes et rapports). */
export function cheminApprentissageParDefaut(): string {
  const depuisEnv = process.env['CCREMOTE_APPRENTISSAGE_DIR'];
  if (depuisEnv !== undefined && depuisEnv.length > 0) return depuisEnv;
  return join(homedir(), '.local', 'share', 'ccremote', 'apprentissage');
}

export function cheminSauvegardesParDefaut(): string {
  return join(cheminApprentissageParDefaut(), 'sauvegardes');
}

export interface ParametresSauvegarde {
  readonly cheminDb: string;
  readonly racineCompetences: string;
  readonly racineSauvegardes?: string;
  readonly maintenant?: Date;
}

export interface ResultatSauvegarde {
  readonly dossier: string;
  readonly aCopieDb: boolean;
  readonly aCopieCompetences: boolean;
}

function horodatageDossier(maintenant: Date): string {
  // `:` interdit dans un nom de dossier sur certains systèmes — remplacé, l'ordre lexical
  // reste identique à l'ordre chronologique (propriété exploitée par `roterSauvegardes`).
  return maintenant.toISOString().replace(/[:.]/g, '-');
}

function copierDbSiPresente(cheminDb: string, dossier: string): boolean {
  if (!existsSync(cheminDb)) return false;
  cpSync(cheminDb, join(dossier, 'apprentissage.db'));
  return true;
}

function copierCompetencesSiPresentes(racineCompetences: string, dossier: string): boolean {
  if (!existsSync(racineCompetences)) return false;
  cpSync(racineCompetences, join(dossier, 'competences'), { recursive: true });
  return true;
}

/**
 * Retire les sauvegardes au-delà des `MAX_SAUVEGARDES_CONSERVEES` plus récentes.
 * `☠` Suppression sur IDENTITÉS EXPLICITES uniquement (chaque dossier listé, jamais un glob) —
 * les noms de dossiers sont des horodatages ISO, donc l'ordre lexical = l'ordre chronologique.
 */
function roterSauvegardes(racine: string): void {
  const dossiers = readdirSync(racine, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
  const enTrop = dossiers.slice(0, Math.max(0, dossiers.length - MAX_SAUVEGARDES_CONSERVEES));
  for (const nom of enTrop) {
    const cible = join(racine, nom);
    journal.info({ cible }, 'rotation des sauvegardes — retrait d’une sauvegarde au-delà des 5 conservées');
    rmSync(cible, { recursive: true, force: true });
  }
}

/**
 * Copie `apprentissage.db` et `competences/` sous `<racine>/<iso>/`, puis applique la
 * rotation à 5. Ne lève jamais : une sauvegarde ratée est journalisée, jamais bloquante pour
 * l'appelant (`consolidation.ts` décide alors de ne PAS lancer la passe mutante).
 */
export function sauvegarderAvantPasse(parametres: ParametresSauvegarde): ResultatSauvegarde {
  return executer(
    'sauvegarderAvantPasse',
    () => {
      const maintenant = parametres.maintenant ?? new Date();
      const racine = parametres.racineSauvegardes ?? cheminSauvegardesParDefaut();
      const dossier = join(racine, horodatageDossier(maintenant));
      mkdirSync(dossier, { recursive: true });
      const aCopieDb = copierDbSiPresente(parametres.cheminDb, dossier);
      const aCopieCompetences = copierCompetencesSiPresentes(parametres.racineCompetences, dossier);
      roterSauvegardes(racine);
      return { dossier, aCopieDb, aCopieCompetences };
    },
    { cheminDb: parametres.cheminDb },
  );
}

/** Listing des sauvegardes présentes, plus ancienne en premier — pour le rapport de passe et les tests. */
export function listerSauvegardes(racine: string): readonly string[] {
  return executer('listerSauvegardes', () => {
    if (!existsSync(racine)) return [];
    return readdirSync(racine, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
  });
}
