// Responsabilité : les résultats d'une session (fichiers envoyés ou créés) — genre et type d'après l'extension, liste
// courante, et contenu d'un résultat servi à l'appli. Seul un chemin de la liste courante est lu ; fichier ordinaire.
import { readFileSync, statSync } from 'node:fs';
import { extname } from 'node:path';
import type { Logger } from 'pino';
import { MAX_OCTETS_RESULTAT, MAX_RESULTATS, type ReponseResultatParite } from '../../commun/parite.ts';
import type { EtatTranscript } from './etat.ts';
import { estAbsent } from './fichier.ts';

export interface ResultatCourant {
  readonly chemin: string;
  readonly origine: 'envoye' | 'cree';
  readonly le: string;
}

interface TypeFichier {
  readonly genre: 'image' | 'page' | 'fichier';
  readonly mime: string;
}

const TYPES: Readonly<Record<string, TypeFichier>> = {
  '.png': { genre: 'image', mime: 'image/png' },
  '.jpg': { genre: 'image', mime: 'image/jpeg' },
  '.jpeg': { genre: 'image', mime: 'image/jpeg' },
  '.gif': { genre: 'image', mime: 'image/gif' },
  '.webp': { genre: 'image', mime: 'image/webp' },
  '.svg': { genre: 'image', mime: 'image/svg+xml' },
  '.html': { genre: 'page', mime: 'text/html' },
  '.htm': { genre: 'page', mime: 'text/html' },
  '.pdf': { genre: 'fichier', mime: 'application/pdf' },
  '.md': { genre: 'fichier', mime: 'text/markdown' },
  '.txt': { genre: 'fichier', mime: 'text/plain' },
  '.json': { genre: 'fichier', mime: 'application/json' },
};
const TYPE_INCONNU: TypeFichier = { genre: 'fichier', mime: 'application/octet-stream' };

export function typeDeFichier(chemin: string): TypeFichier {
  return TYPES[extname(chemin).toLowerCase()] ?? TYPE_INCONNU;
}

/** Les résultats visibles : le plus récent d'abord, un chemin une fois, au plus MAX_RESULTATS. */
export function resultatsCourants(etat: EtatTranscript): ResultatCourant[] {
  return [...etat.resultats.entries()]
    .reverse()
    .slice(0, MAX_RESULTATS)
    .map(([chemin, vu]) => ({ chemin, origine: vu.origine, le: vu.le }));
}

/** Le contenu d'un résultat (base64), ou le refus avec le statut HTTP à rendre. */
export function lireResultat(chemin: string, journal: Logger): ReponseResultatParite {
  let taille: number;
  try {
    const etat = statSync(chemin);
    if (!etat.isFile()) return refus(404, 'ce chemin n’est pas un fichier');
    taille = etat.size;
  } catch (erreur) {
    if (!estAbsent(erreur)) journal.warn({ err: erreur, chemin }, 'résultat illisible');
    return refus(404, 'fichier introuvable');
  }
  if (taille > MAX_OCTETS_RESULTAT) {
    return refus(413, `fichier trop volumineux (${mega(taille)} Mo, limite ${mega(MAX_OCTETS_RESULTAT)} Mo)`);
  }
  try {
    const base64 = readFileSync(chemin).toString('base64');
    return { etat: 'ok', mime: typeDeFichier(chemin).mime, base64 };
  } catch (erreur) {
    journal.warn({ err: erreur, chemin }, 'lecture du résultat interrompue');
    return refus(404, 'fichier illisible');
  }
}

function refus(statut: 404 | 413, raison: string): ReponseResultatParite {
  return { etat: 'refus', statut, raison };
}

function mega(octets: number): number {
  return Math.round((octets / (1024 * 1024)) * 10) / 10;
}
