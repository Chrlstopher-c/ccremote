// Responsabilité : assembler la parité d'une session à partir de son état de transcript — contexte du dernier tour,
// résultats, tâches, dépôt de travail. Le fenêtre de contexte vient de la config du poste.
import { existsSync } from 'node:fs';
import { basename } from 'node:path';
import type { Logger } from 'pino';
import type { ContexteParite, PariteSession, ResultatSession } from '../../commun/parite.ts';
import { depotDeTravail } from './depot.ts';
import type { EtatTranscript, UsageContexte } from './etat.ts';
import { resultatsCourants, typeDeFichier } from './resultat.ts';
import { tachesResumees } from './taches-resume.ts';

export interface EntreeResume {
  readonly cwd: string;
  readonly transcript: string;
  readonly fenetre: number;
  readonly journal: Logger;
}

export async function resumeParite(entree: EntreeResume, etat: EtatTranscript): Promise<PariteSession> {
  return {
    transcript: true,
    contexte: contexteDe(etat.contexte, entree.fenetre),
    resultats: resultatsDe(etat),
    taches: tachesResumees(etat, entree.transcript, entree.journal),
    depot: await depotDeTravail(entree.cwd, etat, entree.journal),
  };
}

function contexteDe(usage: UsageContexte | null, fenetre: number): ContexteParite | null {
  if (usage === null) return null;
  return {
    modele: usage.modele,
    utilises: usage.utilises,
    sortie: usage.sortie,
    fenetre,
    pourcentage: pourcentageDe(usage.utilises, fenetre),
    le: usage.le,
  };
}

/** Part de la fenêtre utilisée, entière et bornée à 0-100. */
export function pourcentageDe(utilises: number, fenetre: number): number {
  if (fenetre <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((100 * utilises) / fenetre)));
}

function resultatsDe(etat: EtatTranscript): ResultatSession[] {
  return resultatsCourants(etat).map((r) => ({
    chemin: r.chemin,
    nom: basename(r.chemin),
    genre: typeDeFichier(r.chemin).genre,
    origine: r.origine,
    le: r.le,
    existe: existsSync(r.chemin),
  }));
}
