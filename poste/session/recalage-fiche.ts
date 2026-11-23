// Responsabilité : recaler la fiche d'une session sur ce que disent son transcript et sa fiche Claude Desktop, à
// l'import, à l'annonce et à la relecture. Une fiche ne garde ni un modèle « défaut », ni un contexte à zéro, ni la
// date de son import à la place de l'activité réelle.
import type { Logger } from 'pino';
import type { ResumeSession } from '../../commun/session.ts';
import { type ModeleDate, plusRecentOpt } from '../../commun/modele-date.ts';
import { nomLisibleModele } from './modele-affiche.ts';
import { type EtatTranscript, etatDuTranscript, tourEnCours } from './etat-transcript.ts';
import type { SessionPersistee } from './persistance.ts';
import { cheminTranscript } from './transcript.ts';
import { titreDuTranscript } from './titre-transcript.ts';
import { type FicheDesktop, RACINE_DESKTOP_DEFAUT, fichesDesktop } from './fiche-desktop.ts';

export interface SourcesFiche {
  readonly etat: EtatTranscript | null;
  readonly desktop: FicheDesktop | null;
  /** Modèle choisi par Remote Control sur cette conversation (gardé par le poste), s'il y en a un. */
  readonly choisi?: ModeleDate | null;
}

/** Le modèle réel d'une conversation : le plus récent du transcript, de la fiche Desktop et du choix (ou null). */
export function modeleDeSources(sources: SourcesFiche): ModeleDate | null {
  const { etat, desktop, choisi } = sources;
  const depuisEtat = etat?.modele ? { modele: etat.modele, le: etat.modeleLe } : null;
  const depuisDesktop = desktop?.modele ? { modele: desktop.modele, le: desktop.modeleLe } : null;
  return plusRecentOpt(plusRecentOpt(depuisEtat, depuisDesktop), choisi ?? null);
}

/** La fiche avec la vérité du transcript (activité, modèle, mode, contexte) et l'archivage Desktop lu. */
export function recalerFiche(fiche: ResumeSession, sources: SourcesFiche): ResumeSession {
  const { etat, desktop } = sources;
  const modele = modeleDeSources(sources);
  // Desktop tient le réglage courant (changé après le dernier message, le transcript ne le dit pas encore).
  const mode = desktop?.mode ?? etat?.mode ?? fiche.mode;
  const contexte = etat?.contexte != null ? { ...fiche.contexte, tokens: etat.contexte } : fiche.contexte;
  const statut = etat && fiche.statut !== 'fermee' ? (tourEnCours(etat, Date.now()) ? 'travail' : 'attente') : null;
  return {
    ...fiche,
    ...(statut ? { statut } : {}),
    majLe: etat?.majLe ?? fiche.majLe,
    modele: modele?.modele ?? fiche.modele,
    ...(modele ? { modeleLe: modele.le } : {}),
    // Modèle changé : son nom suit (sinon l'ancien restait affiché).
    ...(modele && modele.modele !== fiche.modele ? { modeleNom: nomLisibleModele(modele.modele) } : {}),
    contexte,
    ...(mode ? { mode } : {}),
    ...(desktop?.archivee ? { archivee: true } : {}),
  };
}

/** La fiche persistée d'une session fermée, avec son titre relu dans le transcript (une fois, au démarrage). */
export function titreRelu(p: SessionPersistee, journal: Logger): SessionPersistee {
  if (p.resume.statut !== 'fermee') return p;
  const { cwd, id } = p.resume;
  const titre = titreDuTranscript(cheminTranscript(cwd, id, null), cwd, journal) ?? p.resume.titre;
  return { ...p, resume: { ...p.resume, titre } };
}

/** Les sources d'une fiche pour une conversation : son transcript et sa fiche Desktop, si elle en a une. */
export function sourcesDe(
  chemin: string,
  conversation: string,
  journal: Logger,
  racineDesktop: string = RACINE_DESKTOP_DEFAUT,
  choisi: ModeleDate | null = null,
): SourcesFiche {
  return {
    etat: etatDuTranscript(chemin, journal),
    desktop: fichesDesktop(racineDesktop, journal).get(conversation) ?? null,
    choisi,
  };
}
