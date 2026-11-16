// Responsabilité : dire ce que le monde doit montrer d'une session (bloquée, en travail, finie, inactive…).
// Pur : aucune horloge lue ici, le « maintenant » est passé en paramètre.
import type { ResumeSession } from './contrat';

export type EtatAgent = 'bloque' | 'travail' | 'fini' | 'inactive' | 'eteinte' | 'erreur';
export type SessionAgent = Pick<ResumeSession, 'statut' | 'dialogue' | 'majLe' | 'inactiveDepuis'> & {
  // false : la machine de la session ne répond plus, la session n'est jamais active. Absent : inconnu, joignable.
  readonly machineEnLigne?: boolean;
};

export const SEUIL_INACTIVITE_MS = 30 * 60_000;
// Une attente sans aucune activité depuis ce délai n'attend plus personne : la session est éteinte.
export const SEUIL_EXTINCTION_MS = 24 * 60 * 60_000;
const MINUTE_MS = 60_000;

export function etatAgent(s: SessionAgent, maintenant: number): EtatAgent {
  if (s.machineEnLigne === false) return 'eteinte';
  if (s.dialogue || s.statut === 'question') return 'bloque';
  switch (s.statut) {
    case 'erreur':
      return 'erreur';
    case 'fermee':
      return 'eteinte';
    case 'demarrage':
    case 'travail':
    case 'compaction':
      return 'travail';
    case 'attente':
      if (depasse(s, maintenant, SEUIL_EXTINCTION_MS)) return 'eteinte';
      return estInactive(s, maintenant) ? 'inactive' : 'fini';
    case 'terminee':
      return estInactive(s, maintenant) ? 'inactive' : 'fini';
  }
}

// `majLe` est le dernier changement de la session : c'est depuis là qu'elle attend. Une date illisible ne compte pas.
function estInactive(s: SessionAgent, maintenant: number): boolean {
  if (s.inactiveDepuis) return true;
  return depasse(s, maintenant, SEUIL_INACTIVITE_MS);
}

function depasse(s: SessionAgent, maintenant: number, seuilMs: number): boolean {
  const debut = Date.parse(s.majLe);
  if (Number.isNaN(debut)) return false;
  return maintenant - debut >= seuilMs;
}

// Durée depuis `depuis` (ISO) : « moins d'1 min », « 4 min », « 2 h », « 1 j ». Date illisible : « — ».
export function dureeLisible(depuis: string, maintenant: number): string {
  const debut = Date.parse(depuis);
  if (Number.isNaN(debut)) return '—';
  const minutes = Math.floor(Math.max(0, maintenant - debut) / MINUTE_MS);
  if (minutes < 1) return "moins d'1 min";
  if (minutes < 60) return `${minutes} min`;
  const heures = Math.floor(minutes / 60);
  if (heures < 24) return `${heures} h`;
  return `${Math.floor(heures / 24)} j`;
}
