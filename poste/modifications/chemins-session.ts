// Responsabilité : les chemins modifiés par toute une session (et non par les seuls blocs affichés), pour que les
// totaux du panneau couvrent tous ses tours. Une session SDK : ses tours enregistrés sur le disque. Une session suivie
// hors de Lanterne : les fichiers des tours clos de son transcript, lu au fil de l'eau. Le transcript ne fait que
// grandir : seule la suite écrite depuis la lecture précédente est lue. Avant le 25/11/2026, il était relu en entier à
// chaque changement (panneau interrogé toutes les quelques secondes) : 298 Mo par lecture pour une session géante.
import { closeSync, fstatSync, openSync, readSync, statSync } from 'node:fs';
import type { Logger } from 'pino';
import { ligneDe } from '../session/historique.ts';
import { CompteTours } from '../session/tours-transcript.ts';

/** Lecture en cours d'un transcript : où elle en est, l'état des tours et les chemins trouvés. */
interface Lecture {
  inode: number;
  lu: number;
  reste: Buffer;
  readonly compte: CompteTours;
  readonly chemins: Set<string>;
}

const LECTURES = new Map<string, Lecture>();
const MORCEAU = 4 * 1024 * 1024;

/** Chemins absolus des fichiers des tours clos d'un transcript ; seule la suite écrite depuis la dernière fois est lue. */
export function cheminsDuTranscript(chemin: string, journal: Logger): string[] {
  try {
    const etat = statSync(chemin);
    let lecture = LECTURES.get(chemin);
    if (!lecture || lecture.inode !== etat.ino || etat.size < lecture.lu) {
      lecture = { inode: etat.ino, lu: 0, reste: Buffer.alloc(0), compte: new CompteTours(), chemins: new Set() };
      LECTURES.set(chemin, lecture);
    }
    if (etat.size > lecture.lu) lireLaSuite(chemin, lecture);
    return [...lecture.chemins];
  } catch (erreur) {
    LECTURES.delete(chemin);
    journal.warn({ err: erreur, chemin }, 'fichiers du transcript illisibles : chemins de session non relevés');
    return [];
  }
}

/** Lit la suite par morceaux ; une ligne coupée en fin de morceau attend la suivante (octets bruts, UTF-8 intact). */
function lireLaSuite(chemin: string, lecture: Lecture): void {
  const fd = openSync(chemin, 'r');
  try {
    const fin = fstatSync(fd).size;
    const tampon = Buffer.allocUnsafe(MORCEAU);
    while (lecture.lu < fin) {
      const n = readSync(fd, tampon, 0, Math.min(MORCEAU, fin - lecture.lu), lecture.lu);
      if (n <= 0) break;
      lecture.lu += n;
      traiter(lecture, Buffer.concat([lecture.reste, tampon.subarray(0, n)]));
    }
  } finally {
    closeSync(fd);
  }
}

function traiter(lecture: Lecture, octets: Buffer): void {
  const dernier = octets.lastIndexOf(0x0a);
  if (dernier < 0) {
    lecture.reste = octets;
    return;
  }
  lecture.reste = Buffer.from(octets.subarray(dernier + 1));
  for (const texte of octets.subarray(0, dernier).toString('utf8').split('\n')) {
    const ligne = ligneDe(texte);
    if (ligne === null) continue;
    for (const evt of lecture.compte.ligne(ligne)) {
      if (evt.type === 'fichiers_tour') for (const f of evt.fichiers) lecture.chemins.add(f.chemin);
    }
  }
}
