// Responsabilité : lire, dans le fil d'une session claude.ai, le modèle annoncé et l'état de tour (travail en cours).
import { objet, texte } from '../comptes/valeurs.ts';

// Modèle qu'un événement du fil annonce : `system/init`, ou un message assistant (jamais un modèle « <…> »).
export function modeleDuFil(payload: unknown): string | null {
  const p = objet(payload);
  if (texte(p['type']) === 'system' && texte(p['subtype']) === 'init') return texte(p['model']);
  if (texte(p['type']) !== 'assistant') return null;
  const modele = texte(objet(p['message'])['model']);
  return modele !== null && !modele.startsWith('<') ? modele : null;
}

/** La session travaille (ou attend Chris) selon claude.ai : son fil avance sans que last_event_at ne bouge. */
export function enTour(travail: string | null): boolean {
  return travail === 'running' || travail === 'requires_action';
}
