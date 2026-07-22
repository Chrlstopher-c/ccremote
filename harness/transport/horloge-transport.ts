/**
 * Responsabilité : port de temps du domaine transport, pour rendre le backoff
 * de reconnexion injectable en test sans jamais dépendre de `test-harness`
 * (règle 1 de test-harness/README.md : aucun module de production n'importe
 * ce dossier). Forme volontairement minimale, propre à ce domaine.
 */

export type AnnulerMinuterie = () => void;

export interface HorlogeTransport {
  planifier(delaiMs: number, action: () => void): AnnulerMinuterie;
}

export const HORLOGE_REELLE: HorlogeTransport = {
  planifier(delaiMs, action) {
    const id = setTimeout(action, delaiMs);
    return () => clearTimeout(id);
  },
};
