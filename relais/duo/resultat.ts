// Responsabilité : le résultat d'une opération du mode duo — une valeur, ou un refus avec son statut HTTP.
export type Resultat<T> = { ok: true; valeur: T } | { ok: false; statut: number; raison: string };

export const STATUT_REFUS_DUO = 409;

export function ok<T>(valeur: T): Resultat<T> {
  return { ok: true, valeur };
}

export function echec<T = never>(statut: number, raison: string): Resultat<T> {
  return { ok: false, statut, raison };
}
