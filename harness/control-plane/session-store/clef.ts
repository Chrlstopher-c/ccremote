/**
 * Responsabilité : normalisation de `SessionKey` (H-12 : le miroir ne fait que relayer,
 * jamais parser le contenu — mais la clé, elle, doit être normalisée pour l'indexation).
 */

import type { SessionKey } from '@anthropic-ai/claude-agent-sdk';

/** `undefined` = transcript principal ⇒ normalisé en chaîne vide pour l'indexation SQL. */
export const SOUS_CHEMIN_PRINCIPAL = '';

/**
 * ☠ Le SDK documente explicitement : « Empty string is invalid — omit the field for
 * the main transcript. » Un appelant qui passe `subpath: ''` a un bug (probablement une
 * confusion avec `undefined`) — refuser plutôt que de le traiter silencieusement comme
 * le transcript principal, ce qui masquerait l'erreur de l'appelant.
 */
export function normaliserSousChemin(cle: SessionKey): string {
  if (cle.subpath === '') {
    throw new Error(
      "SessionKey.subpath vide ('') est invalide — omettre le champ pour le transcript principal",
    );
  }
  return cle.subpath ?? SOUS_CHEMIN_PRINCIPAL;
}

export function estTranscriptPrincipal(sousChemin: string): boolean {
  return sousChemin === SOUS_CHEMIN_PRINCIPAL;
}
