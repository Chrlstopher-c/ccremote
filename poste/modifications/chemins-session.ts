// Responsabilité : les chemins modifiés par toute une session (et non par les seuls blocs affichés), pour que les
// totaux du panneau couvrent tous ses tours. Une session SDK : ses tours enregistrés sur le disque. Une session suivie
// hors de Lanterne : les fichiers des tours clos de son transcript, lu au fil de l'eau. Le transcript ne fait que
// grandir : seule la suite écrite depuis la lecture précédente est lue. Avant le 25/11/2026, il était relu en entier à
// chaque changement (panneau interrogé toutes les quelques secondes) : 298 Mo par lecture pour une session géante.
import { statSync } from 'node:fs';
import type { Logger } from 'pino';
import { ligneDe } from '../session/historique.ts';
import { lireLignes } from '../session/lecture-lignes.ts';
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

function lireLaSuite(chemin: string, lecture: Lecture): void {
  const suite = lireLignes(
    chemin,
    (texte) => {
      const ligne = ligneDe(texte);
      if (ligne === null) return;
      for (const evt of lecture.compte.ligne(ligne)) {
        if (evt.type === 'fichiers_tour') for (const f of evt.fichiers) lecture.chemins.add(f.chemin);
      }
    },
    lecture.lu,
    lecture.reste,
  );
  lecture.lu = suite.lu;
  lecture.reste = suite.reste;
}
