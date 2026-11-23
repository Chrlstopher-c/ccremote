// Responsabilité : le relais de l'API Claude entre nœuds — un invité fait tourner Claude Code avec le compte du chef
// sans recevoir son jeton. Constantes, schémas des messages `claude_*`, filtres d'en-têtes. Aucune E/S.
import { z } from 'zod';

export const CHEMINS_CLAUDE_PERMIS: readonly string[] = ['/v1/messages', '/v1/messages/count_tokens'];
const REQUETE_PERMISE = 'beta=true';
/** En-têtes qu'un invité peut faire passer au chef (minuscules) : tout le reste est retiré des deux côtés. */
export const ENTETES_REQUETE_PERMIS: readonly string[] = [
  'accept',
  'anthropic-beta',
  'anthropic-client-platform',
  'anthropic-client-version',
  'anthropic-version',
  'content-type',
  'user-agent',
  'x-app',
  'x-claude-code-session-id',
];
const ENTETES_REPONSE_PERMIS: readonly string[] = ['content-type', 'request-id'];
const PREFIXE_RATELIMIT = 'anthropic-ratelimit-';
export const BETA_OAUTH = 'oauth-2025-04-20';
export const VERSION_API = '2023-06-01';
export const URL_API_PAR_DEFAUT = 'https://api.anthropic.com';
/** Délai maximal avant le premier octet de la réponse (en-tête reçu) : au-delà, 504 côté invité. */
export const DELAI_PREMIER_OCTET_MS = 60_000;
/** Fenêtre pendant laquelle une session Claude Code compte parmi les simultanées d'un invité. */
export const FENETRE_SESSIONS_MS = 10 * 60_000;
/** Nombre de morceaux maximal d'un flux relayé (un flux d'API compte bien plus de trames qu'un corps). */
export const MORCEAUX_MAX_FLUX = 1_000_000;
/** Un corps tient en ligne (base64) jusqu'à cette taille ; au-delà il part en morceaux. */
export const TAILLE_CORPS_EN_LIGNE = 128 * 1024;
/** Octets bruts par morceau : leur base64 fait exactement TAILLE_CORPS_EN_LIGNE caractères (multiple de 3). */
export const OCTETS_MORCEAU_CLAUDE = (TAILLE_CORPS_EN_LIGNE / 4) * 3;

export type TypeErreurClaude =
  | 'authentication_error'
  | 'invalid_request_error'
  | 'not_found_error'
  | 'permission_error'
  | 'rate_limit_error'
  | 'api_error';

export function entetePermiseRequete(nom: string): boolean {
  return ENTETES_REQUETE_PERMIS.includes(nom);
}

export function entetePermiseReponse(nom: string): boolean {
  return ENTETES_REPONSE_PERMIS.includes(nom) || nom.startsWith(PREFIXE_RATELIMIT);
}

/** Vrai pour un chemin de l'API permis au relais : `/v1/messages` (ou count_tokens), avec `?beta=true` seulement. */
export function cheminPermis(chemin: string): boolean {
  const [base, requete, reste] = chemin.split('?');
  if (reste !== undefined) return false;
  if (requete !== undefined && requete !== REQUETE_PERMISE) return false;
  return CHEMINS_CLAUDE_PERMIS.includes(base ?? '');
}

/** Les en-têtes de la liste blanche, en minuscules ; le reste (authentification, cookies…) disparaît. */
export function entetesRequete(entrees: Iterable<readonly [string, string]>): Record<string, string> {
  return filtrerEntetes(entrees, entetePermiseRequete);
}

/** Les en-têtes de réponse à transmettre (type, identifiant de requête, limites), en minuscules. */
export function entetesReponse(entrees: Iterable<readonly [string, string]>): Record<string, string> {
  return filtrerEntetes(entrees, entetePermiseReponse);
}

function filtrerEntetes(
  entrees: Iterable<readonly [string, string]>,
  permis: (nom: string) => boolean,
): Record<string, string> {
  const lus: Record<string, string> = {};
  for (const [nom, valeur] of entrees) {
    const minuscule = nom.toLowerCase();
    if (permis(minuscule)) lus[minuscule] = valeur;
  }
  return lus;
}

/** La liste des bêtas du client, avec la bêta OAuth ajoutée (une seule fois). */
export function fusionnerBeta(valeur: string | undefined): string {
  const liste = (valeur ?? '')
    .split(',')
    .map((beta) => beta.trim())
    .filter((beta) => beta.length > 0);
  if (!liste.includes(BETA_OAUTH)) liste.push(BETA_OAUTH);
  return liste.join(',');
}

/** Corps d'erreur au format de l'API Anthropic, que Claude Code affiche tel quel. */
export function erreurAnthropic(type: TypeErreurClaude, message: string): string {
  return JSON.stringify({ type: 'error', error: { type, message } });
}

const NOM_ENTETE = z.string().min(1).max(64);
const ENTETES_REQUETE = z
  .record(NOM_ENTETE, z.string().max(4000))
  .refine((e) => Object.keys(e).every(entetePermiseRequete), 'en-tête non permis');
const ENTETES_REPONSE = z
  .record(NOM_ENTETE, z.string().max(500))
  .refine((e) => Object.keys(e).every(entetePermiseReponse), 'en-tête de réponse non permis');
const REF = z.string().min(1).max(64);

/** Requête d'un invité vers le chef. Le corps part en ligne (`corps`, base64) ou en `morceaux` après ce message. */
export const ClaudeRequete = z.strictObject({
  t: z.literal('claude_requete'),
  ref: REF,
  methode: z.enum(['GET', 'POST', 'HEAD']),
  chemin: z
    .string()
    .min(5)
    .max(2000)
    .regex(/^\/v1\//),
  entetes: ENTETES_REQUETE,
  corps: z.string().max(TAILLE_CORPS_EN_LIGNE).optional(),
  morceaux: z.number().int().min(1).max(MORCEAUX_MAX_FLUX).optional(),
});
/** En-têtes de la réponse, puis ses morceaux (`morceau`, même référence), puis `claude_fin`. */
export const ClaudeEntete = z.strictObject({
  t: z.literal('claude_entete'),
  ref: REF,
  statut: z.number().int().min(100).max(599),
  entetes: ENTETES_REPONSE,
});
/** Fin de la réponse : `morceaux` = leur nombre ; `ok` faux si le flux a été coupé en route. */
export const ClaudeFin = z.strictObject({
  t: z.literal('claude_fin'),
  ref: REF,
  morceaux: z.number().int().min(0).max(MORCEAUX_MAX_FLUX),
  ok: z.boolean(),
  raison: z.string().max(300).optional(),
});
/** L'invité n'attend plus la réponse (fermeture du client, délai dépassé) : le chef coupe son appel à l'API. */
export const ClaudeAnnuler = z.strictObject({ t: z.literal('claude_annuler'), ref: REF });

export type ClaudeRequete = z.infer<typeof ClaudeRequete>;
export type ClaudeEntete = z.infer<typeof ClaudeEntete>;
export type ClaudeFin = z.infer<typeof ClaudeFin>;
export type ClaudeAnnuler = z.infer<typeof ClaudeAnnuler>;
