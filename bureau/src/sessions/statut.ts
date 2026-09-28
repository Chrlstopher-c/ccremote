// Responsabilité : comment se dit et se montre le statut d'une session.
import type { StatutSession } from '../../../commun/session.ts';

export const STATUTS: Record<StatutSession, { readonly libelle: string; readonly ton: 'actif' | 'calme' | 'eteint' | 'alerte' }> = {
  demarrage: { libelle: 'Démarre', ton: 'actif' },
  travail: { libelle: 'Travaille', ton: 'actif' },
  compaction: { libelle: 'Compacte', ton: 'actif' },
  attente: { libelle: 'En attente', ton: 'calme' },
  question: { libelle: 'Question', ton: 'alerte' },
  terminee: { libelle: 'Objectif atteint', ton: 'calme' },
  erreur: { libelle: 'Erreur', ton: 'alerte' },
  fermee: { libelle: 'Fermée', ton: 'eteint' },
};

export const estVivante = (s: StatutSession): boolean => s !== 'fermee';
