// Responsabilité : relier le monde au modèle de données — quelles sessions ont un bureau, et dans quel état le jeu
// doit montrer chacune (traduction de l'état d'agent du modèle vers ce que Clawd fait dans le bâtiment).
import { etatAgent, sessionsActives, type EtatMonde as EtatDonnees, type ResumeSession } from '../donnees';
import type { EtatMonde } from './persos/agent';

/** Les sessions qui occupent un bureau, dans un ordre stable (les plus anciennes à gauche). */
export function sessionsDuMonde(etat: EtatDonnees): ResumeSession[] {
  return [...sessionsActives(etat)].sort((a, b) => a.creeLe.localeCompare(b.creeLe));
}

/** null : session éteinte, son bureau reste vide. */
export function etatDansLeMonde(s: ResumeSession, maintenant: number): EtatMonde | null {
  const e = etatAgent(s, maintenant);
  if (e === 'eteinte') return null;
  if (e === 'erreur') return 'bloque';
  return e;
}

export const cleSessions = (sessions: readonly ResumeSession[]): string => sessions.map((s) => s.id).join('|');
