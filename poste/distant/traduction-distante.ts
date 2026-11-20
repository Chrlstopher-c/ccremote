// Responsabilité : traduire le fil d'une session claude.ai (payloads du Claude Agent SDK) en événements du fil de
// Quart,
// dans l'ordre d'arrivée. Pur hors l'état de traduction passé en paramètre. Un payload inconnu est ignoré.
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { type EtatTraduction, traduireSdk } from '../session/traduction-sdk.ts';
import type { EvenementHorodate } from '../session/historique.ts';
import { objet } from '../comptes/valeurs.ts';
import type { EvenementBrut } from './donnees.ts';
import type { Evenement } from '../../commun/session.ts';

/** Un payload est un message du SDK s'il porte un type textuel ; le reste n'est pas traduit. */
export function estMessageSdk(v: unknown): v is SDKMessage {
  return typeof objet(v)['type'] === 'string';
}

/** Les événements d'un lot, dans l'ordre donné (du plus ancien au plus récent), horodatés par leur création. */
export function traduireLot(brutes: readonly EvenementBrut[], etat: EtatTraduction): EvenementHorodate[] {
  return brutes.flatMap((brute) => {
    if (!estMessageSdk(brute.payload)) return [];
    const sortie = traduireSdk(brute.payload, etat);
    const evenements = sortie.evenements.some((evt) => evt.type === 'message')
      ? sortie.evenements
      : [...messageUtilisateur(brute.payload), ...sortie.evenements];
    return evenements.map((evt) => ({ ts: brute.creeLe ?? '', evt }));
  });
}

/** Message tapé par Chris (ici, sur claude.ai ou par le relais) : le traducteur du SDK ne le rend pas, car dans une
 * session du poste c'est Quart qui l'a envoyé et l'a déjà inscrit. Les retours d'outils et messages méta sont exclus. */
function messageUtilisateur(payload: SDKMessage): Evenement[] {
  const p = objet(payload);
  if (p['type'] !== 'user' || p['isMeta'] === true || p['isSynthetic'] === true) return [];
  const contenu = objet(p['message'])['content'];
  const texte =
    typeof contenu === 'string'
      ? contenu
      : Array.isArray(contenu) && contenu.every((b) => objet(b)['type'] === 'text')
        ? contenu.map((b) => String(objet(b)['text'] ?? '')).join('\n')
        : '';
  const uuid = typeof p['uuid'] === 'string' ? { uuid: p['uuid'] } : {};
  return texte.trim() === '' ? [] : [{ type: 'message', texte, ...uuid }];
}
