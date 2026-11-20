// Responsabilité : traduire le fil d'une session claude.ai (payloads du Claude Agent SDK) en événements du fil de Quart,
// dans l'ordre d'arrivée. Pur hors l'état de traduction passé en paramètre. Un payload inconnu est ignoré.
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { type EtatTraduction, traduireSdk } from '../session/traduction-sdk.ts';
import type { EvenementHorodate } from '../session/historique.ts';
import { objet } from '../comptes/valeurs.ts';
import type { EvenementBrut } from './donnees.ts';

/** Un payload est un message du SDK s'il porte un type textuel ; le reste n'est pas traduit. */
export function estMessageSdk(v: unknown): v is SDKMessage {
  return typeof objet(v)['type'] === 'string';
}

/** Les événements d'un lot, dans l'ordre donné (du plus ancien au plus récent), horodatés par leur création. */
export function traduireLot(brutes: readonly EvenementBrut[], etat: EtatTraduction): EvenementHorodate[] {
  return brutes.flatMap((brute) => {
    if (!estMessageSdk(brute.payload)) return [];
    const sortie = traduireSdk(brute.payload, etat);
    return sortie.evenements.map((evt) => ({ ts: brute.creeLe ?? '', evt }));
  });
}
