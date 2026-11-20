// Responsabilité : lire des segments d'un fichier sur le poste (un intervalle d'octets, la fin d'un fichier) sans le
// charger entier. Lecture seule ; un fichier absent ou illisible rend null et est journalisé (absent : silencieux).
import { closeSync, openSync, readSync, statSync } from 'node:fs';
import type { Logger } from 'pino';

/** Les octets [debut, debut + longueur) du fichier ; moins si le fichier est plus court. null si illisible. */
export function lireSegment(chemin: string, debut: number, longueur: number, journal: Logger): Buffer | null {
  const tampon = Buffer.alloc(longueur);
  let fd: number | null = null;
  try {
    fd = openSync(chemin, 'r');
    let lu = 0;
    while (lu < longueur) {
      const n = readSync(fd, tampon, lu, longueur - lu, debut + lu);
      if (n === 0) break;
      lu += n;
    }
    return lu === longueur ? tampon : tampon.subarray(0, lu);
  } catch (erreur) {
    if (!estAbsent(erreur)) journal.warn({ err: erreur, chemin }, 'lecture de fichier de parité interrompue');
    return null;
  } finally {
    if (fd !== null) closeSync(fd);
  }
}

/** La fin d'un fichier ordinaire, au plus `maxOctets` ; la première ligne d'une lecture faite au milieu est écartée. */
export function lireFin(chemin: string, maxOctets: number, journal: Logger): string | null {
  let taille: number;
  try {
    const etat = statSync(chemin);
    if (!etat.isFile()) return null;
    taille = etat.size;
  } catch (erreur) {
    if (!estAbsent(erreur)) journal.warn({ err: erreur, chemin }, 'fin de fichier illisible');
    return null;
  }
  const debut = Math.max(0, taille - maxOctets);
  const octets = lireSegment(chemin, debut, taille - debut, journal);
  if (octets === null) return null;
  const texte = octets.toString('utf8');
  return debut > 0 ? texte.slice(texte.indexOf('\n') + 1) : texte;
}

export function estAbsent(erreur: unknown): boolean {
  return typeof erreur === 'object' && erreur !== null && 'code' in erreur && erreur.code === 'ENOENT';
}
