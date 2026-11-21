// Responsabilité : les chemins modifiés par toute une session (et non par les seuls blocs affichés), pour que les
// totaux du panneau couvrent tous ses tours. Une session SDK : ses tours enregistrés sur le disque. Une session suivie
// hors de Lanterne : les fichiers des tours clos de son transcript, relu quand il a changé. Pur hors lecture.
import { readFileSync, statSync } from 'node:fs';
import type { Logger } from 'pino';
import { lignesDe } from '../session/historique.ts';
import { cheminsModifies } from '../session/tours-transcript.ts';

const DEJA_LUS = new Map<string, { marque: string; chemins: string[] }>();

/** Chemins absolus des fichiers des tours clos d'un transcript ; relu seulement si sa taille ou sa date a changé. */
export function cheminsDuTranscript(chemin: string, journal: Logger): string[] {
  try {
    const etat = statSync(chemin);
    const marque = `${etat.size}:${Math.trunc(etat.mtimeMs)}`;
    const connu = DEJA_LUS.get(chemin);
    if (connu?.marque === marque) return connu.chemins;
    const chemins = cheminsModifies(lignesDe(readFileSync(chemin, 'utf8')));
    DEJA_LUS.set(chemin, { marque, chemins });
    return chemins;
  } catch (erreur) {
    journal.warn({ err: erreur, chemin }, 'fichiers du transcript illisibles : chemins de session non relevés');
    return [];
  }
}
