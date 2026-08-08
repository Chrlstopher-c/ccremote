/**
 * Responsabilité : ce que les trois graphiques de la section « Les mesures » partagent —
 * regroupement par condition dans l'ordre fixe du contrat, et légende des trois couleurs.
 * Aucune donnée mesurée écrite en dur : uniquement de l'ordonnancement et du gabarit.
 */

import { CONDITIONS, type Condition } from '../../experience/contrat.ts';
import { libelleCondition, pastilleCondition } from '../utils.ts';

export interface GroupeCondition<T> {
  readonly condition: Condition;
  readonly items: readonly T[];
}

/** Regroupe une liste d'éléments par condition, dans l'ordre fixe `CONDITIONS` du contrat. */
export function groupesParCondition<T extends { readonly condition: Condition }>(
  items: readonly T[],
): ReadonlyArray<GroupeCondition<T>> {
  return CONDITIONS.map((condition) => ({ condition, items: items.filter((item) => item.condition === condition) }));
}

export function legendeConditions(): string {
  const items = CONDITIONS.map(
    (c) => `<span class="legende-item">${pastilleCondition(c)}${libelleCondition(c)} (${c})</span>`,
  ).join('\n');
  return `<div class="legende">${items}</div>`;
}
