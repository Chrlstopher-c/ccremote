// Responsabilité : lire un transcript de parité au fil de l'eau. Un accumulateur par chemin garde la position en octets
// et l'état agrégé ; chaque appel ne lit que les octets ajoutés. Fichier plus petit que la position : repart de zéro.
import { statSync } from 'node:fs';
import type { Logger } from 'pino';
import { appliquerLigne } from './appliquer.ts';
import { type EtatTranscript, etatVide } from './etat.ts';
import { estAbsent, lireSegment } from './fichier.ts';
import { lireLigne } from './lignes.ts';

interface Accumulateur {
  position: number;
  /** Octets d'une dernière ligne encore incomplète (écrite en cours par Claude Code). */
  reste: Buffer;
  readonly etat: EtatTranscript;
}

const MAX_ACCUMULATEURS = 64;
const accumulateurs = new Map<string, Accumulateur>();

/** L'état du transcript à l'instant de l'appel ; null si le fichier n'existe pas ou n'est pas lisible. */
export function lireEtat(chemin: string, journal: Logger): EtatTranscript | null {
  const taille = tailleDe(chemin, journal);
  if (taille === null) {
    accumulateurs.delete(chemin);
    return null;
  }
  const acc = accumulateurPour(chemin, taille);
  if (taille > acc.position) avancer(acc, chemin, taille, journal);
  return acc.etat;
}

/** Vide le cache des accumulateurs (tests, nettoyage). */
export function oublierEtats(): void {
  accumulateurs.clear();
}

function tailleDe(chemin: string, journal: Logger): number | null {
  try {
    return statSync(chemin).size;
  } catch (erreur) {
    if (!estAbsent(erreur)) journal.warn({ err: erreur, chemin }, 'transcript de parité illisible');
    return null;
  }
}

function accumulateurPour(chemin: string, taille: number): Accumulateur {
  const existant = accumulateurs.get(chemin);
  if (existant && taille >= existant.position) return existant;
  const neuf: Accumulateur = { position: 0, reste: Buffer.alloc(0), etat: etatVide() };
  accumulateurs.delete(chemin);
  accumulateurs.set(chemin, neuf);
  if (accumulateurs.size > MAX_ACCUMULATEURS) {
    const premier = accumulateurs.keys().next();
    if (!premier.done) accumulateurs.delete(premier.value);
  }
  return neuf;
}

function avancer(acc: Accumulateur, chemin: string, taille: number, journal: Logger): void {
  const ajout = lireSegment(chemin, acc.position, taille - acc.position, journal);
  if (ajout === null) return;
  acc.position = taille;
  const tout = Buffer.concat([acc.reste, ajout]);
  const fin = tout.lastIndexOf(0x0a);
  if (fin < 0) {
    acc.reste = Buffer.from(tout);
    return;
  }
  acc.reste = Buffer.from(tout.subarray(fin + 1));
  for (const brut of tout.subarray(0, fin).toString('utf8').split('\n')) {
    const ligne = lireLigne(brut, journal);
    if (ligne) appliquerLigne(acc.etat, ligne);
  }
}
