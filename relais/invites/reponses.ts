// Responsabilité : les réponses négatives qu'un nœud renvoie à un pair (reponse ok:false, geste 403) — une seule forme.
import type { MessageChiffre } from '../../commun/federation.ts';

/** Refus d'une requête de session (`reponse` avec la même référence). */
export function reponseRefus(ref: string, raison: string): MessageChiffre {
  return { t: 'reponse', ref, ok: false, raison };
}

/** Refus d'un geste relayé : `geste_reponse` 403 avec le motif lisible. */
export function gesteRefus(ref: string, statut: number, raison: string): MessageChiffre {
  return { t: 'geste_reponse', ref, statut, corps: JSON.stringify({ erreur: raison }) };
}
