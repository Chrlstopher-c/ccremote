// Responsabilité : recaler la fiche d'une session sur ce que disent son transcript et sa fiche Claude Desktop, à
// l'import, à l'annonce et à la relecture. Une fiche ne garde ni un modèle « défaut », ni un contexte à zéro, ni la
// date de son import à la place de l'activité réelle.
import type { Logger } from 'pino';
import type { ResumeSession } from '../../commun/session.ts';
import { type EtatTranscript, etatDuTranscript } from './etat-transcript.ts';
import { type FicheDesktop, RACINE_DESKTOP_DEFAUT, fichesDesktop } from './fiche-desktop.ts';

export interface SourcesFiche {
  readonly etat: EtatTranscript | null;
  readonly desktop: FicheDesktop | null;
}

/** La fiche avec la vérité du transcript (activité, modèle, mode, contexte) et l'archivage Desktop lu. */
export function recalerFiche(fiche: ResumeSession, sources: SourcesFiche): ResumeSession {
  const { etat, desktop } = sources;
  const mode = etat?.mode ?? desktop?.mode ?? fiche.mode;
  const contexte = etat?.contexte != null ? { ...fiche.contexte, tokens: etat.contexte } : fiche.contexte;
  return {
    ...fiche,
    majLe: etat?.majLe ?? fiche.majLe,
    modele: etat?.modele ?? desktop?.modele ?? fiche.modele,
    contexte,
    ...(mode ? { mode } : {}),
    ...(desktop?.archivee ? { archivee: true } : {}),
  };
}

/** Les sources d'une fiche pour une conversation : son transcript et sa fiche Desktop, si elle en a une. */
export function sourcesDe(
  chemin: string,
  conversation: string,
  journal: Logger,
  racineDesktop: string = RACINE_DESKTOP_DEFAUT,
): SourcesFiche {
  return {
    etat: etatDuTranscript(chemin, journal),
    desktop: fichesDesktop(racineDesktop, journal).get(conversation) ?? null,
  };
}
