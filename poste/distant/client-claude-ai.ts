// Responsabilité : le client HTTP de l'API des sessions de claude.ai — liste et fil en lecture, envoi d'un événement
// (message, interruption, réglage, réponse) en écriture. Le jeton OAuth est lu dans le dossier du compte à chaque
// appel, jamais gardé, jamais journalisé, jamais renouvelé. Une erreur HTTP ou réseau rend un résultat typé.
import type { Logger } from 'pino';
import { AGENT_CLI, lireJetonFichier } from '../comptes/lecture-compte.ts';
import { objet, texte, tableau } from '../comptes/valeurs.ts';
import { type PageEvenements, type SessionBrute, lirePage, lireSession } from './donnees.ts';

const API_PAR_DEFAUT = 'https://api.anthropic.com';
const BETA_SESSIONS = 'ccr-byoc-2025-07-29';
const DELAI_MS = 20_000;
const LIMITE_LISTE = 50;
// Un refus 403 dont le corps parle d'appareil : le compte exige un appareil de confiance pour piloter la session.
const MOTIF_APPAREIL = /trusted device|appareil de confiance|bound|attest/i;

export type ResultatApi<T> =
  | { readonly ok: true; readonly donnees: T }
  | { readonly ok: false; readonly statut: number; readonly probleme: string; readonly refusAppareil?: boolean };

interface Reponse {
  readonly statut: number;
  readonly corps: string;
}

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

/** Vrai si le corps d'un refus 403 désigne un appareil de confiance (ou un appareil lié à la session). */
export function estRefusAppareil(corps: string): boolean {
  return MOTIF_APPAREIL.test(corps);
}

/** Une requête authentifiée. Le chemin (sans jeton ni corps) sert seul à journaliser. */
async function requeter(
  configDir: string | null,
  methode: 'GET' | 'POST',
  chemin: string,
  journal: Logger,
  corps?: unknown,
): Promise<{ ok: true; reponse: Reponse } | { ok: false; statut: number; probleme: string; refusAppareil?: boolean }> {
  const trace = chemin.split('?')[0];
  try {
    const jeton = lireJetonFichier(configDir);
    if (jeton === null) {
      return { ok: false, statut: 0, probleme: 'jeton absent ou expiré : relancer la connexion du compte' };
    }
    const reponse = await fetch(`${apiClaudeAi()}${chemin}`, {
      method: methode,
      headers: entetes(jeton),
      body: corps === undefined ? undefined : JSON.stringify(corps),
      signal: AbortSignal.timeout(DELAI_MS),
    });
    const texteReponse = await reponse.text();
    if (reponse.ok) return { ok: true, reponse: { statut: reponse.status, corps: texteReponse } };
    const refusAppareil = reponse.status === 403 && estRefusAppareil(texteReponse);
    journal.warn({ statut: reponse.status, chemin: trace, methode }, 'API claude.ai : réponse refusée');
    return { ok: false, statut: reponse.status, probleme: problemeHttp(reponse.status), refusAppareil };
  } catch (erreur) {
    journal.warn({ err: erreur, chemin: trace, methode }, 'API claude.ai : appel en échec');
    return { ok: false, statut: 0, probleme: 'claude.ai injoignable ou réponse illisible' };
  }
}

/** Les sessions de la liste (toutes environnements et statuts : le filtrage est fait par l'appelant). */
export async function listerSessions(configDir: string | null, journal: Logger): Promise<ResultatApi<SessionBrute[]>> {
  const r = await requeter(configDir, 'GET', `/v1/code/sessions?limit=${LIMITE_LISTE}`, journal);
  if (!r.ok) return r;
  const sessions = tableau(objet(parser(r.reponse.corps, journal))['data']).flatMap((brut) => {
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
  const r = await requeter(configDir, 'GET', chemin, journal);
  if (!r.ok) return r;
  return { ok: true, donnees: lirePage(parser(r.reponse.corps, journal)) };
}

/** Envoie un événement à la session (`{events: [evt]}`). Rend seulement si claude.ai l'a accepté. */
export async function envoyerEvenement(
  configDir: string | null,
  idSession: string,
  evenement: Record<string, unknown>,
  journal: Logger,
): Promise<ResultatApi<null>> {
  const type = texte(evenement['type']);
  const sousType = texte(objet(evenement['request'])['subtype']);
  const r = await requeter(configDir, 'POST', `/v1/code/sessions/${encodeURIComponent(idSession)}/events`, journal, {
    events: [evenement],
  });
  if (!r.ok) {
    journal.warn({ type, sousType, statut: r.statut }, 'envoi à la session claude.ai refusé');
    return r;
  }
  return { ok: true, donnees: null };
}

// Le corps d'une réponse est du JSON ; un corps illisible devient un objet vide, journalisé.
function parser(corps: string, journal: Logger): unknown {
  try {
    return JSON.parse(corps);
  } catch (erreur) {
    journal.warn({ err: erreur }, 'API claude.ai : réponse non JSON');
    return {};
  }
}
