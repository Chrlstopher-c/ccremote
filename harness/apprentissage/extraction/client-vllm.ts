/**
 * Responsabilité : SEUL point de sortie réseau du domaine `apprentissage` (SPEC §3, C-3).
 * Un unique appel `POST {URL}/v1/chat/completions`, compatible OpenAI, vers vLLM local.
 *
 * `☠` Indisponibilité (connexion refusée, timeout, 5xx) ⇒ résultat TYPÉ `{ disponible: false }`,
 * JAMAIS une exception qui remonte — c'est le contrat qui protège la clôture d'une mission
 * (PLAN-PORTAGE.md, E4, et SPEC §1 : « aucune passe d'apprentissage ne doit jamais bloquer,
 * ralentir ou faire échouer une mission »). Aucun repli sur un modèle payant : contrainte dure,
 * full local, zéro token de quota Claude.
 *
 * Conception inspirée de Hermes Agent (Nous Research) — MIT. Transposition indépendante en TypeScript.
 */

import { journal } from '../logger.ts';

const TIMEOUT_MS = 45_000;
const TENTATIVES_MAX = 2;
const TEMPERATURE = 0.2;
const MAX_TOKENS_SORTIE = 300;

export interface ParametresAppelVllm {
  readonly prompt: string;
  /** Défaut : `CCREMOTE_APPRENTISSAGE_VLLM_URL`. */
  readonly url?: string;
  /** Défaut : `CCREMOTE_APPRENTISSAGE_VLLM_MODELE`. */
  readonly modele?: string;
}

export interface ReponseVllmDisponible {
  readonly disponible: true;
  readonly contenu: string;
}

export interface ReponseVllmIndisponible {
  readonly disponible: false;
  readonly motif: string;
}

export type ReponseVllm = ReponseVllmDisponible | ReponseVllmIndisponible;

interface CorpsChatCompletions {
  readonly choices?: readonly { readonly message?: { readonly content?: string } }[];
}

function decrireErreur(cause: unknown): string {
  if (cause instanceof Error) {
    if (cause.name === 'TimeoutError' || cause.name === 'AbortError') return 'timeout (45 s dépassé)';
    return cause.message;
  }
  return String(cause);
}

function extraireContenu(corps: unknown): string | null {
  const c = corps as CorpsChatCompletions;
  const contenu = c.choices?.[0]?.message?.content;
  return typeof contenu === 'string' ? contenu : null;
}

async function unAppel(url: string, modele: string, prompt: string): Promise<ReponseVllm> {
  try {
    const reponse = await fetch(`${url}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: modele,
        messages: [{ role: 'user', content: prompt }],
        temperature: TEMPERATURE,
        max_tokens: MAX_TOKENS_SORTIE,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!reponse.ok) return { disponible: false, motif: `HTTP ${reponse.status}` };
    const contenu = extraireContenu(await reponse.json());
    if (contenu === null) return { disponible: false, motif: 'réponse vLLM sans contenu exploitable' };
    return { disponible: true, contenu };
  } catch (cause) {
    return { disponible: false, motif: decrireErreur(cause) };
  }
}

/**
 * Appelle vLLM. Au plus `TENTATIVES_MAX` (2) essais, boucle bornée (standard maison) —
 * au-delà, la passe est abandonnée et l'observation reste rejouable (SPEC §3).
 */
export async function appellerVllm(parametres: ParametresAppelVllm): Promise<ReponseVllm> {
  const url = parametres.url ?? process.env['CCREMOTE_APPRENTISSAGE_VLLM_URL'];
  const modele = parametres.modele ?? process.env['CCREMOTE_APPRENTISSAGE_VLLM_MODELE'];
  if (url === undefined || url.length === 0) {
    journal.warn('CCREMOTE_APPRENTISSAGE_VLLM_URL non configuré — passe différée');
    return { disponible: false, motif: 'url vLLM non configurée' };
  }
  if (modele === undefined || modele.length === 0) {
    journal.warn('CCREMOTE_APPRENTISSAGE_VLLM_MODELE non configuré — passe différée');
    return { disponible: false, motif: 'modèle vLLM non configuré' };
  }

  let derniereReponse: ReponseVllm = { disponible: false, motif: 'aucune tentative effectuée' };
  for (let tentative = 1; tentative <= TENTATIVES_MAX; tentative += 1) {
    derniereReponse = await unAppel(url, modele, parametres.prompt);
    if (derniereReponse.disponible) return derniereReponse;
    journal.warn({ tentative, motif: derniereReponse.motif, url }, 'appel vLLM en échec — vLLM indisponible ou en erreur');
  }
  return derniereReponse;
}
