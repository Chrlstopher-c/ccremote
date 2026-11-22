// Responsabilité : la vue des autres membres sur une session d'invité (titre générique, rien de lisible).
import { ResumeSession } from './session.ts';

/** Ce que les autres ne voient jamais d'une session d'invité : dossier, fil, identifiants, prompt, connecteurs. */
const EFFACE_POUR_AUTRES = {
  cwd: '',
  objectif: null,
  claudeSessionId: null,
  tmux: null,
  dialogue: null,
  remoteControl: null,
  distant: null,
  connecteurs: [],
  prompt_systeme: null,
  style_sortie: null,
};

/** Garde l'identité et l'activité de la session ; le reste est effacé (EFFACE_POUR_AUTRES). */
export function masquerPourAutres(s: ResumeSession, nom: string, membre: string): ResumeSession {
  return ResumeSession.parse({
    ...EFFACE_POUR_AUTRES,
    id: s.id,
    machine: s.machine,
    projet: { ...s.projet, chemin: '', nom: 'Invités' },
    titre: `Conversation de ${nom}`,
    modele: s.modele,
    modeleNom: s.modeleNom,
    modeleLe: s.modeleLe,
    compte: s.compte,
    autonomie: s.autonomie,
    statut: s.statut,
    contexte: s.contexte,
    etapes: s.etapes,
    compactions: s.compactions,
    moteur: s.moteur,
    mode: s.mode,
    effort: s.effort,
    attachee: s.attachee,
    pilotee: s.pilotee,
    archivee: s.archivee,
    inactiveDepuis: s.inactiveDepuis,
    creeLe: s.creeLe,
    majLe: s.majLe,
    invite: { membre, nom },
  });
}

export function estSessionInvite(s: ResumeSession): boolean {
  return s.invite !== undefined;
}
