// Responsabilité : le résultat d'un geste de la fédération — une valeur, ou un statut HTTP et une raison lisible.
export type Resultat<T> =
  { readonly ok: true; readonly valeur: T } | { readonly ok: false; readonly statut: number; readonly raison: string };

export function ok<T>(valeur: T): Resultat<T> {
  return { ok: true, valeur };
}

export function echec<T = never>(statut: number, raison: string): Resultat<T> {
  return { ok: false, statut, raison };
}
