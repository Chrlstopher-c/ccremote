/**
 * Responsabilité : SEUL point de sortie réseau du domaine `apprentissage` (SPEC §3, C-3).
 *
 * `☠ CORRECTION DE CAP (2026-08-08)` — ce module appelait vLLM local (Qwen3 8B AWQ) ;
 * l'opérateur a annulé cette contrainte. L'inférence de toute la boucle d'apprentissage
 * passe désormais par le SDK Claude Code, en mode non interactif (`maxTurns: 1`, aucun
 * outil), sur le compte déjà connecté sur ce PC (`compte-a`) — exactement le mécanisme que
 * `harness/anti-boucle/juge-haiku.ts` utilise déjà pour le juge anti-boucle (H-68), repris
 * ici plutôt que réinventé. `CLAUDE_CONFIG_DIR` isole totalement les identifiants du compte
 * pour ce process, sur le modèle de `superviseur/sonde-quotas.ts`.
 *
 * Modèle imposé par l'opérateur : Haiku 4.5 (`claude-haiku-4-5-20251001`) — résumer un
 * transcript déjà réduit et en extraire deux ou trois leçons courtes ne demande pas mieux,
 * et c'est ce qui protège le quota du compte.
 *
 * `☠` Indisponibilité (réseau, timeout, quota, réponse inexploitable) ⇒ résultat TYPÉ
 * `{ disponible: false }`, JAMAIS une exception qui remonte — c'est le contrat qui protège
 * la clôture d'une mission (PLAN-PORTAGE.md, E4/E6, et SPEC §1). Aucun repli sur un modèle
 * payant distinct : c'est déjà le compte qui paie les équipes, pas un service tiers.
 *
 * Conception inspirée de Hermes Agent (Nous Research) — MIT. Transposition indépendante en TypeScript.
 */

import { query as sdkQuery } from '@anthropic-ai/claude-agent-sdk';
import type { Options, Query, SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { journal } from '../logger.ts';

/** Modèle imposé par l'opérateur (2026-08-08) — ne pas monter de sa propre initiative. */
export const MODELE_APPRENTISSAGE_PAR_DEFAUT = 'claude-haiku-4-5-20251001';

/** Repli si `CCREMOTE_APPRENTISSAGE_CONFIG_DIR` n'est pas posé — le compte déjà connecté ici. */
const CONFIG_DIR_PAR_DEFAUT = join(homedir(), '.claude-comptes', 'compte-a');

const TIMEOUT_MS = 45_000;
const TENTATIVES_MAX = 2;

export interface ParametresAppelModele {
  readonly prompt: string;
  /** Défaut : `CCREMOTE_APPRENTISSAGE_CONFIG_DIR`, sinon le compte-a de cette machine. */
  readonly configDir?: string;
  /** Défaut : `CCREMOTE_APPRENTISSAGE_MODELE`, sinon `MODELE_APPRENTISSAGE_PAR_DEFAUT`. */
  readonly modele?: string;
}

export interface ReponseModeleDisponible {
  readonly disponible: true;
  readonly contenu: string;
}

export interface ReponseModeleIndisponible {
  readonly disponible: false;
  readonly motif: string;
}

export type ReponseModele = ReponseModeleDisponible | ReponseModeleIndisponible;

/** Fonction d'appel SDK injectable — même forme que `AntiBoucleQueryFn` (tests sans réseau). */
export type FonctionQuerySdk = (params: { readonly prompt: string; readonly options?: Options }) => Query;

export interface DependancesClientInference {
  readonly query?: FonctionQuerySdk;
}

export interface ClientInference {
  readonly appelerModele: (parametres: ParametresAppelModele) => Promise<ReponseModele>;
}

function decrireErreur(cause: unknown): string {
  if (cause instanceof Error) {
    if (cause.name === 'TimeoutError' || cause.name === 'AbortError') return 'timeout (45 s dépassé)';
    return cause.message;
  }
  return String(cause);
}

function extraireTexteResultat(message: SDKMessage): string | null {
  if (message.type !== 'result' || message.subtype !== 'success') return null;
  return message.result;
}

async function attendreResultat(flux: Query, timeoutMs: number): Promise<string | null> {
  const lecture = (async (): Promise<string | null> => {
    for await (const message of flux) {
      const texte = extraireTexteResultat(message);
      if (texte !== null) return texte;
      if (message.type === 'result') return null; // error_* : flux terminé sans texte exploitable.
    }
    return null;
  })();
  const minuterie = new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), timeoutMs));
  const resultat = await Promise.race([lecture, minuterie]);
  if (resultat === 'timeout') throw Object.assign(new Error('timeout'), { name: 'TimeoutError' });
  return resultat;
}

async function unAppel(
  executerQuery: FonctionQuerySdk,
  prompt: string,
  configDir: string,
  modele: string,
): Promise<ReponseModele> {
  try {
    const flux = executerQuery({
      prompt,
      options: {
        model: modele,
        maxTurns: 1,
        tools: [],
        permissionMode: 'default',
        env: { ...process.env, CLAUDE_CONFIG_DIR: configDir },
      },
    });
    const texte = await attendreResultat(flux, TIMEOUT_MS);
    if (texte === null) return { disponible: false, motif: 'flux terminé sans message result exploitable' };
    return { disponible: true, contenu: texte };
  } catch (cause) {
    return { disponible: false, motif: decrireErreur(cause) };
  }
}

/**
 * Crée le client d'inférence du domaine — un appel = une requête one-shot sur Haiku,
 * au plus `TENTATIVES_MAX` (2) essais (boucle bornée, standard maison).
 */
export function creerClientInference(deps: DependancesClientInference = {}): ClientInference {
  const executerQuery = deps.query ?? ((params) => sdkQuery(params));

  return {
    async appelerModele(parametres: ParametresAppelModele): Promise<ReponseModele> {
      const configDir =
        parametres.configDir ?? process.env['CCREMOTE_APPRENTISSAGE_CONFIG_DIR'] ?? CONFIG_DIR_PAR_DEFAUT;
      const modele =
        parametres.modele ?? process.env['CCREMOTE_APPRENTISSAGE_MODELE'] ?? MODELE_APPRENTISSAGE_PAR_DEFAUT;

      let derniereReponse: ReponseModele = { disponible: false, motif: 'aucune tentative effectuée' };
      for (let tentative = 1; tentative <= TENTATIVES_MAX; tentative += 1) {
        derniereReponse = await unAppel(executerQuery, parametres.prompt, configDir, modele);
        if (derniereReponse.disponible) return derniereReponse;
        journal.warn(
          { tentative, motif: derniereReponse.motif, configDir, modele },
          'appel au modèle d’apprentissage en échec — indisponible ou en erreur',
        );
      }
      return derniereReponse;
    },
  };
}
