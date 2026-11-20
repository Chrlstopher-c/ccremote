// Responsabilité : traduire la réponse de « Utiliser une réinitialisation » (POST reset_rate_limits) et les refus HTTP
// vers le résultat commun. Pur, sans I/O.
import type { ResultatReinitialisation } from '../../commun/compte-detail.ts';
import { nombre, objet, texte, textes } from './valeurs.ts';

export function echecReinitialisation(resultat: string, raison: string): ResultatReinitialisation {
  return {
    resultat,
    raison,
    restantes: null,
    efface: [],
    semaineRemiseLe: null,
    attenteJusquA: null,
  };
}

/** Un refus HTTP qui ne dit rien de l'offre : 429, 401/403, autre échec. Null si la réponse est un succès. */
export function refusHttp(statut: number): ResultatReinitialisation | null {
  if (statut === 429) return echecReinitialisation('rate_limited', 'trop de demandes : réessaie plus tard');
  if (statut === 401 || statut === 403)
    return echecReinitialisation('auth_error', 'jeton refusé par Anthropic : reconnecte le compte');
  if (statut < 200 || statut >= 300) return echecReinitialisation('error', `HTTP ${statut}`);
  return null;
}

export function resultatReinitialisation(corps: unknown): ResultatReinitialisation {
  const x = objet(corps);
  const resultat = texte(x['result']);
  if (resultat === null) return echecReinitialisation('error', 'réponse illisible');
  return {
    resultat,
    raison: texte(x['reason']),
    restantes: nombre(x['resets_left']),
    efface: textes(x['cleared']),
    semaineRemiseLe: texte(x['weekly_resets_at']),
    attenteJusquA: texte(x['cooldown_until']),
  };
}
