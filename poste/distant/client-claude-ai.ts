// Responsabilité : le client HTTP de l'API des sessions de claude.ai (liste des sessions, fil d'une session), en lecture.
// Le jeton OAuth est lu dans le dossier du compte à chaque appel, jamais gardé, jamais journalisé, jamais renouvelé.
// Une erreur HTTP ou réseau rend un résultat typé (statut, problème lisible), jamais une exception.
import type { Logger } from 'pino';
import { AGENT_CLI, lireJetonFichier } from '../comptes/lecture-compte.ts';
import { type PageEvenements, type SessionBrute, lirePage, lireSession } from './donnees.ts';
import { objet, tableau } from '../comptes/valeurs.ts';

const API_PAR_DEFAUT = 'https://api.anthropic.com';
const BETA_SESSIONS = 'ccr-byoc-2025-07-29';
const DELAI_MS = 20_000;
const LIMITE_LISTE = 50;

export type ResultatApi<T> =
  | { readonly ok: true; readonly donnees: T }
  | { readonly ok: false; readonly statut: number; readonly probleme: string };

function apiClaudeAi(): string {
  return (process.env['CCREMOTE_API_CLAUDE_AI'] || API_PAR_DEFAUT).replace(/\/+$/, '');
}

function entetes(jeton: string): Record<string, string> {
  return {
    authorization: `Bearer ${jeton}`,
    'anthropic-version': '2023-06-01',
    'anthropic-beta': BETA_SESSIONS,
    'content-type': 'application/json',
    'user-agent': AGENT_CLI,
  };
}

function problemeHttp(statut: number): string {
  if (statut === 401) return 'jeton OAuth expiré ou refusé : relancer la connexion du compte';
  if (statut === 403) return 'accès refusé par claude.ai (appareil de confiance ?)';
  if (statut === 429) return 'trop de requêtes vers claude.ai : nouvel essai au prochain tour';
  return `réponse HTTP ${statut} de claude.ai`;
}

/** GET authentifié. Le chemin (sans jeton) sert seul à journaliser. */
async function lire(configDir: string | null, chemin: string, journal: Logger): Promise<ResultatApi<unknown>> {
  try {
    const jeton = lireJetonFichier(configDir);
    if (jeton === null) {
      return { ok: false, statut: 0, probleme: 'jeton absent ou expiré : relancer la connexion du compte' };
    }
    const reponse = await fetch(`${apiClaudeAi()}${chemin}`, {
      headers: entetes(jeton),
      signal: AbortSignal.timeout(DELAI_MS),
    });
    if (!reponse.ok) {
      journal.warn({ statut: reponse.status, chemin: chemin.split('?')[0] }, 'API claude.ai : réponse refusée');
      return { ok: false, statut: reponse.status, probleme: problemeHttp(reponse.status) };
    }
    return { ok: true, donnees: await reponse.json() };
  } catch (erreur) {
    journal.warn({ err: erreur, chemin: chemin.split('?')[0] }, 'API claude.ai : appel en échec');
    return { ok: false, statut: 0, probleme: 'claude.ai injoignable ou réponse illisible' };
  }
}

/** Les sessions de la liste (toutes environnements et statuts : le filtrage est fait par l'appelant). */
export async function listerSessions(configDir: string | null, journal: Logger): Promise<ResultatApi<SessionBrute[]>> {
  const r = await lire(configDir, `/v1/code/sessions?limit=${LIMITE_LISTE}`, journal);
  if (!r.ok) return r;
  const sessions = tableau(objet(r.donnees)['data']).flatMap((brut) => {
    const session = lireSession(brut);
    return session === null ? [] : [session];
  });
  return { ok: true, donnees: sessions };
}

export interface OptionsEvenements {
  readonly curseur?: string | null; // page suivante, dans l'ordre décroissant (du plus récent au plus ancien)
  readonly limite?: number;
}

/** Une page du fil d'une session, du plus récent au plus ancien. */
export async function lireEvenements(
  configDir: string | null,
  idSession: string,
  journal: Logger,
  options: OptionsEvenements = {},
): Promise<ResultatApi<PageEvenements>> {
  const curseur = options.curseur ? `&cursor=${encodeURIComponent(options.curseur)}` : '';
  const limite = options.limite ?? 100;
  const chemin = `/v1/code/sessions/${encodeURIComponent(idSession)}/events?sort_order=desc&limit=${limite}${curseur}`;
  const r = await lire(configDir, chemin, journal);
  if (!r.ok) return r;
  return { ok: true, donnees: lirePage(r.donnees) };
}
