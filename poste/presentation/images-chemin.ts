// Responsabilité : les images qu'un outil désigne par leur chemin dans son résultat texte (capture d'écran
// écrite sur disque). Repérage des chemins pur ; lecture bornée (taille, dossiers permis, liens résolus).
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { basename, extname, isAbsolute, sep } from 'node:path';
import type { Logger } from 'pino';
import { TAILLE_MAX_FICHIER } from '../../commun/presentation.ts';
import type { ImageSdk } from './images.ts';

export type LireImageChemin = (chemin: string) => ImageSdk | null;

const MAX_CHEMINS = 8;
const CHAMPS_CHEMIN: readonly string[] = ['path', 'filename', 'file_path', 'filePath', 'screenshot'];
const MIME_PAR_EXTENSION: ReadonlyMap<string, string> = new Map([
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
  ['.gif', 'image/gif'],
]);

type Objet = Record<string, unknown>;

function estObjet(v: unknown): v is Objet {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function blocsDe(v: unknown): Objet[] {
  return Array.isArray(v) ? v.filter(estObjet) : [];
}

function mimeDe(chemin: string): string | null {
  return MIME_PAR_EXTENSION.get(extname(chemin).toLowerCase()) ?? null;
}

// Absolu et d'extension image : une URL ou un chemin relatif n'est jamais lu.
function estCheminImage(candidat: string): boolean {
  return isAbsolute(candidat) && mimeDe(candidat) !== null;
}

function parserJson(texte: string): unknown {
  try {
    return JSON.parse(texte);
  } catch {
    return undefined;
  }
}

function textesDe(bloc: Objet): string[] {
  const contenu = bloc['content'];
  if (typeof contenu === 'string') return [contenu];
  return blocsDe(contenu).flatMap((b) => {
    const texte = b['text'];
    return b['type'] === 'text' && typeof texte === 'string' ? [texte] : [];
  });
}

// Candidats d'un texte : les champs chemin d'un objet JSON, ou le texte entier s'il n'est qu'une ligne.
function candidatsDe(texte: string): string[] {
  const valeur = parserJson(texte);
  if (estObjet(valeur)) {
    return CHAMPS_CHEMIN.flatMap((champ) => {
      const v = valeur[champ];
      return typeof v === 'string' ? [v] : [];
    });
  }
  const seul = texte.trim();
  return seul.includes('\n') ? [] : [seul];
}

/** Chemins absolus d'images cités par les résultats d'outils d'une ligne : au plus 8, sans doublon. */
export function cheminsImagesDuResultat(contenu: unknown): string[] {
  const candidats = blocsDe(contenu)
    .filter((bloc) => bloc['type'] === 'tool_result')
    .flatMap(textesDe)
    .flatMap(candidatsDe)
    .map((c) => c.trim())
    .filter(estCheminImage);
  return [...new Set(candidats)].slice(0, MAX_CHEMINS);
}

// Racines réelles (liens résolus) : une racine introuvable est journalisée et ignorée.
function racinesReelles(racines: readonly string[], journal: Logger): string[] {
  return racines.flatMap((racine) => {
    try {
      return [realpathSync(racine)];
    } catch (erreur) {
      journal.warn({ err: erreur, racine }, 'dossier d’images introuvable, ignoré');
      return [];
    }
  });
}

function dansRacines(chemin: string, racines: readonly string[]): boolean {
  return racines.some((racine) => chemin === racine || chemin.startsWith(racine.endsWith(sep) ? racine : racine + sep));
}

function estAbsent(erreur: unknown): boolean {
  return erreur instanceof Error && 'code' in erreur && erreur.code === 'ENOENT';
}

function lireFichier(reel: string, mime: string, journal: Logger): ImageSdk | null {
  const info = statSync(reel);
  if (!info.isFile()) return null;
  if (info.size > TAILLE_MAX_FICHIER) {
    journal.warn({ chemin: reel, taille: info.size }, 'image trop lourde pour le fil, écartée');
    return null;
  }
  return { mime, base64: readFileSync(reel).toString('base64'), nom: basename(reel) };
}

/**
 * Lecteur d'images par chemin. `racines` null (session normale) : tout chemin lisible ; une liste : seulement les
 * fichiers réels situés sous ces dossiers (un lien symbolique qui sort est refusé).
 */
export function lecteurImagesChemin(racines: readonly string[] | null, journal: Logger): LireImageChemin {
  const permises = racines === null ? null : racinesReelles(racines, journal);
  return (chemin) => {
    const mime = mimeDe(chemin);
    if (mime === null) return null;
    try {
      const reel = realpathSync(chemin);
      if (permises !== null && !dansRacines(reel, permises)) {
        journal.warn({ chemin }, 'image hors des dossiers permis, ignorée');
        return null;
      }
      return lireFichier(reel, mime, journal);
    } catch (erreur) {
      if (!estAbsent(erreur)) journal.warn({ err: erreur, chemin }, 'image par chemin illisible');
      return null;
    }
  };
}
