// Responsabilité : comment se dit et se montre le statut d'une session.
import type { StatutSession } from '../../../commun/session.ts';

export const STATUTS: Record<
  StatutSession,
  { readonly libelle: string; readonly ton: 'actif' | 'calme' | 'eteint' | 'alerte' }
> = {
  demarrage: { libelle: 'Démarre', ton: 'actif' },
  travail: { libelle: 'Travaille', ton: 'actif' },
  compaction: { libelle: 'Compacte', ton: 'actif' },
  attente: { libelle: 'En attente', ton: 'calme' },
  question: { libelle: 'Question', ton: 'alerte' },
  terminee: { libelle: 'Objectif atteint', ton: 'calme' },
  erreur: { libelle: 'Erreur', ton: 'alerte' },
  fermee: { libelle: 'Fermée', ton: 'eteint' },
};

export function estVivante(s: StatutSession): boolean {
  return s !== 'fermee';
}

/** Vivante : dans tmux (pilotable) ou dans un terminal ordinaire (lecture seule). */
export function estOuverte(s: { readonly tmux: string | null; readonly terminal?: boolean }): boolean {
  return s.tmux !== null || s.terminal === true;
}
