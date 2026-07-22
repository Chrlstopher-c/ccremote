/**
 * Responsabilité : port de temps du domaine discipline-contexte, injectable en
 * test sans jamais dépendre de `test-harness` (règle 1, test-harness/README.md
 * : aucun module de production n'importe ce dossier). Même motif que
 * `transport/horloge-transport.ts` et `control-plane/audit-permissions/types.ts`
 * — forme minimale, propre à ce domaine, dupliquée plutôt qu'importée.
 */

export type AnnulerMinuterie = () => void

export interface Horloge {
  /** Instant courant en millisecondes. */
  maintenant(): number
  /** Planifie `action` dans `delaiMs`. Retourne un annulateur idempotent. */
  planifier(delaiMs: number, action: () => void): AnnulerMinuterie
}

export const HORLOGE_REELLE: Horloge = {
  maintenant: () => Date.now(),
  planifier(delaiMs, action) {
    const id = setTimeout(action, delaiMs)
    return () => clearTimeout(id)
  },
}
