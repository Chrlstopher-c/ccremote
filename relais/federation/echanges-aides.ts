// Responsabilité : les petites aides des échanges entre nœuds — lire la réponse d'un geste local, aplatir une liste
// de messages, refus d'un transfert cassé. Pures ou sans état ; les échanges (echanges.ts) les appellent.
import type { MessageChiffre } from '../../commun/federation.ts';

export interface Bilan {
  readonly ok: boolean;
  readonly raison?: string;
  readonly corps?: unknown;
}

/** Relit la réponse HTTP d'un geste local : statut, motif d'erreur, corps. */
export async function lireBilan(reponse: Response): Promise<Bilan> {
  const corps: unknown = await reponse.json().catch(() => null);
  if (reponse.ok) return { ok: true, corps };
  const erreur =
    corps && typeof corps === 'object' && 'erreur' in corps ? String(corps.erreur) : `refus ${reponse.status}`;
  return { ok: false, raison: erreur };
}

/** Une liste de messages à envoyer dans l'ordre (un seul message : une liste d'un élément). */
export function enListe(m: MessageChiffre | readonly MessageChiffre[]): readonly MessageChiffre[] {
  return 't' in m ? [m] : m;
}

export function erreurTransfert(ref: string): MessageChiffre {
  return { t: 'geste_reponse', ref, statut: 502, corps: JSON.stringify({ erreur: 'transfert interrompu' }) };
}
