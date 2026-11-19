// Responsabilité : les tours enregistrés sur le disque du poste, `<donnees>/tours/<session>/<tour>.json` (avant et
// après en base64). Dossiers en 0700, fichiers en 0600 : le contenu des fichiers peut être sensible.
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';

const FichierEnregistre = z.object({
  absolu: z.string(),
  avant: z.string().nullable(), // base64 ; null = absent avant le tour
  apres: z.string().nullable(), // base64 ; null = absent après le tour
  ajouts: z.number().int().nonnegative(),
  suppressions: z.number().int().nonnegative(),
  binaire: z.boolean(),
});
export type FichierEnregistre = z.infer<typeof FichierEnregistre>;

export const TourEnregistre = z.object({
  tour: z.string(),
  sessionId: z.string(),
  creeLe: z.string(),
  annule: z.boolean(),
  annuleLe: z.string().optional(),
  fichiers: z.array(FichierEnregistre),
});
export type TourEnregistre = z.infer<typeof TourEnregistre>;

export function dossierTours(donnees: string, sessionId: string): string {
  return join(donnees, 'tours', sessionId);
}

/** Dossier des fichiers temporaires de comparaison (dans les données du poste, pas dans /tmp). */
export function dossierTemporaire(donnees: string): string {
  return join(donnees, 'tours', '.tmp');
}

export function lireTour(dossier: string, tour: string): TourEnregistre | null {
  const chemin = join(dossier, `${tour}.json`);
  if (!existsSync(chemin)) return null;
  return TourEnregistre.parse(JSON.parse(readFileSync(chemin, 'utf8')));
}

export function listerTours(dossier: string): TourEnregistre[] {
  if (!existsSync(dossier)) return [];
  return readdirSync(dossier)
    .filter((nom) => nom.endsWith('.json'))
    .map((nom) => TourEnregistre.parse(JSON.parse(readFileSync(join(dossier, nom), 'utf8'))));
}

/** Écriture atomique : un fichier temporaire, puis son renommage. */
export function ecrireTour(dossier: string, tour: TourEnregistre): void {
  mkdirSync(dossier, { recursive: true, mode: 0o700 });
  const chemin = join(dossier, `${tour.tour}.json`);
  const temporaire = `${chemin}.tmp`;
  writeFileSync(temporaire, JSON.stringify(tour), { mode: 0o600 });
  renameSync(temporaire, chemin);
}
