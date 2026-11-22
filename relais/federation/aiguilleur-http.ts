// Responsabilité : l'appairage d'un nœud auprès de l'aiguilleur (POST /api/membres/appairer) — le code à usage unique,
// le nom du nœud et sa clé publique partent ; l'identifiant, le jeton et le propriétaire reviennent.
// Le code et le jeton ne sont jamais journalisés : seul le statut d'échec l'est.
import type { Logger } from 'pino';
import { z } from 'zod';
import { CHEMIN_APPAIRAGE_MEMBRE } from '../../commun/aiguilleur.ts';
import { ConfigAiguilleur } from './secrets.ts';

const DELAI_MS = 10_000;

const Reponse = z.object({
  id: ConfigAiguilleur.shape.id,
  jeton: ConfigAiguilleur.shape.jeton,
  proprietaire: ConfigAiguilleur.shape.proprietaire,
});

export type ResultatAppairageNoeud =
  | { readonly ok: true; readonly id: string; readonly jeton: string; readonly proprietaire?: string }
  | { readonly ok: false; readonly statut: number; readonly raison: string };

const RAISON_PAR_STATUT: Record<number, string> = {
  400: 'requête refusée par l’aiguilleur',
  401: 'code refusé ou expiré',
  429: 'trop de tentatives, réessaie plus tard',
};
const RAISON_INJOIGNABLE = 'aiguilleur injoignable';

export interface CorpsAppairageNoeud {
  readonly code: string;
  readonly nom: string;
  readonly cle: string;
}

/** Urls acceptées pour l'aiguilleur : http ou https, sans chemin imposé (le chemin de l'API est ajouté ici). */
export function urlAiguilleurValide(brut: string): string | null {
  try {
    const u = new URL(brut);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.origin;
  } catch {
    return null;
  }
}

export async function appairerNoeud(
  url: string,
  corps: CorpsAppairageNoeud,
  journal: Logger,
): Promise<ResultatAppairageNoeud> {
  try {
    const rep = await fetch(new URL(CHEMIN_APPAIRAGE_MEMBRE, url), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...corps, genre: 'noeud' }),
      signal: AbortSignal.timeout(DELAI_MS),
    });
    if (!rep.ok) return echecStatut(rep.status);
    const r = Reponse.safeParse(await rep.json());
    if (!r.success) return { ok: false, statut: 502, raison: 'réponse de l’aiguilleur non conforme' };
    return { ok: true, id: r.data.id, jeton: r.data.jeton, proprietaire: r.data.proprietaire };
  } catch (erreur) {
    journal.warn({ err: erreur }, 'appairage au nœud aiguilleur : aiguilleur injoignable');
    return { ok: false, statut: 502, raison: RAISON_INJOIGNABLE };
  }
}

function echecStatut(statut: number): ResultatAppairageNoeud {
  return {
    ok: false,
    statut: statut === 401 || statut === 429 ? statut : 502,
    raison: RAISON_PAR_STATUT[statut] ?? RAISON_INJOIGNABLE,
  };
}
