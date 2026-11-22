// Responsabilité : les sessions d'invité d'un nœud — à qui est une session, et ce qui reste privé pour les autres.
import type { ResumeSession } from '../../commun/session.ts';
import type { Registre } from '../registre/registre.ts';

/** Ce qu'un autre que l'invité peut demander sur sa session : interrompre, archiver, désarchiver. Rien d'autre. */
const PERMIS_AUTRES: ReadonlySet<string> = new Set(['interrompre', 'archiver', 'desarchiver']);
const STATUTS_EN_COURS: ReadonlySet<string> = new Set(['demarrage', 'travail', 'compaction', 'question']);

/** Membre invité propriétaire de la session, ou null pour une session ordinaire. */
export function inviteDe(s: ResumeSession | null): string | null {
  return s?.invite?.membre ?? null;
}

/** Vrai pour un suffixe de route qui livre du contenu (fil, fichiers, messages, réglages…), à refuser aux autres. */
export function contenuPrive(suffixe: string): boolean {
  return !PERMIS_AUTRES.has(suffixe);
}

export function enCours(s: ResumeSession): boolean {
  return STATUTS_EN_COURS.has(s.statut);
}

/** Sessions d'un invité sur ce nœud (archivées comprises : elles comptent dans son activité). */
export function sessionsDe(registre: Registre, membre: string): ResumeSession[] {
  return registre.sessions(true).filter((s) => inviteDe(s) === membre);
}

export function sessionsEnCoursDe(registre: Registre, membre: string): number {
  return sessionsDe(registre, membre).filter(enCours).length;
}
