/**
 * Responsabilité : valider STRICTEMENT toute sortie du modèle local avant la moindre
 * écriture (SPEC §3, §5.3, C-3 `☠`). Une sortie de modèle est une entrée non fiable, au
 * même titre qu'une entrée utilisateur (code-standards.md, « Model output is untrusted
 * input ») : parsée, validée contre un schéma explicite, rejetée avant écriture si elle ne
 * correspond pas. Le message de rejet liste toujours les valeurs acceptées — un modèle se
 * corrige depuis une liste, jamais depuis un échec muet.
 *
 * Conception inspirée de Hermes Agent (Nous Research) — MIT. Transposition indépendante en TypeScript.
 */

/** Forme de sortie exigée du modèle pour une leçon candidate (SPEC §5.3). */
export interface LeconExtraite {
  /** Une phrase, impératif, ≤ 200 caractères. */
  readonly enonce: string;
  readonly categorie: 'outil' | 'projet' | 'methode' | 'piege';
  readonly portee: 'projet' | 'machine' | 'global';
  /** ≤ 200 caractères, cité depuis le `ResumeMission`. */
  readonly preuve: string;
  /** Id d'une leçon active, si c'en est une reformulation ; sinon `null`. */
  readonly doublonDe: string | null;
}

export type ResultatGarde<T> =
  | { readonly accepte: true; readonly valeur: T }
  | { readonly accepte: false; readonly motif: string };

const CATEGORIES_ACCEPTEES = ['outil', 'projet', 'methode', 'piege'] as const;
const PORTEES_ACCEPTEES = ['projet', 'machine', 'global'] as const;
const MAX_ENONCE = 200;
const MAX_PREUVE = 200;
const MAX_LECONS_PAR_PASSE = 3;

interface ChampValide<T> {
  readonly ok: true;
  readonly valeur: T;
}
interface ChampInvalide {
  readonly ok: false;
  readonly motif: string;
}
type ResultatChamp<T> = ChampValide<T> | ChampInvalide;

function aperçu(texte: string): string {
  return texte.length > 120 ? `${texte.slice(0, 120)}…` : texte;
}

function validerChaineBornee(valeur: unknown, nomChamp: string, max: number): ResultatChamp<string> {
  if (typeof valeur !== 'string' || valeur.length === 0) {
    return { ok: false, motif: `« ${nomChamp} » doit être une chaîne non vide` };
  }
  if (valeur.length > max) {
    return { ok: false, motif: `« ${nomChamp} » dépasse ${max} caractères (reçu ${valeur.length})` };
  }
  return { ok: true, valeur };
}

function validerEnum<T extends string>(valeur: unknown, nomChamp: string, acceptees: readonly T[]): ResultatChamp<T> {
  if (typeof valeur === 'string' && (acceptees as readonly string[]).includes(valeur)) {
    return { ok: true, valeur: valeur as T };
  }
  return {
    ok: false,
    motif: `« ${nomChamp} » invalide : « ${String(valeur)} » — valeurs acceptées : ${acceptees.join(', ')}`,
  };
}

function validerDoublonDe(valeur: unknown): ResultatChamp<string | null> {
  if (valeur === null || valeur === undefined) return { ok: true, valeur: null };
  if (typeof valeur === 'string' && valeur.length > 0) return { ok: true, valeur };
  return { ok: false, motif: '« doublonDe » doit être une chaîne (id de leçon) ou null' };
}

function parserObjetJson(brut: string): ResultatChamp<Record<string, unknown>> {
  let objet: unknown;
  try {
    objet = JSON.parse(brut);
  } catch {
    return { ok: false, motif: `JSON invalide ou tronqué — impossible de parser la sortie du modèle : « ${aperçu(brut)} »` };
  }
  if (objet === null || typeof objet !== 'object' || Array.isArray(objet)) {
    return { ok: false, motif: `la sortie doit être un objet JSON — reçu : « ${aperçu(brut)} »` };
  }
  return { ok: true, valeur: objet as Record<string, unknown> };
}

/**
 * Valide UNE sortie brute contre le schéma `LeconExtraite`. Rejette avant toute écriture
 * (SPEC §3 `☠`) : JSON invalide, type hors domaine, champ manquant ou trop long.
 */
export function validerLeconExtraite(brut: string): ResultatGarde<LeconExtraite> {
  const objetAnalyse = parserObjetJson(brut);
  if (!objetAnalyse.ok) return { accepte: false, motif: objetAnalyse.motif };
  const o = objetAnalyse.valeur;

  const enonce = validerChaineBornee(o['enonce'], 'enonce', MAX_ENONCE);
  if (!enonce.ok) return { accepte: false, motif: enonce.motif };
  const categorie = validerEnum(o['categorie'], 'categorie', CATEGORIES_ACCEPTEES);
  if (!categorie.ok) return { accepte: false, motif: categorie.motif };
  const portee = validerEnum(o['portee'], 'portee', PORTEES_ACCEPTEES);
  if (!portee.ok) return { accepte: false, motif: portee.motif };
  const preuve = validerChaineBornee(o['preuve'], 'preuve', MAX_PREUVE);
  if (!preuve.ok) return { accepte: false, motif: preuve.motif };
  const doublonDe = validerDoublonDe(o['doublonDe']);
  if (!doublonDe.ok) return { accepte: false, motif: doublonDe.motif };

  return {
    accepte: true,
    valeur: {
      enonce: enonce.valeur,
      categorie: categorie.valeur,
      portee: portee.valeur,
      preuve: preuve.valeur,
      doublonDe: doublonDe.valeur,
    },
  };
}

/**
 * Valide la forme réellement servie par le modèle : un tableau de 0 à 3 leçons candidates
 * (SPEC §5, C-3 : « rend 0 à 3 leçons candidates »). Délègue à `validerLeconExtraite` pour
 * chaque élément — la première leçon invalide rejette le tableau entier, jamais un rejet
 * partiel silencieux.
 */
export function validerLeconsExtraites(brut: string): ResultatGarde<readonly LeconExtraite[]> {
  let tableau: unknown;
  try {
    tableau = JSON.parse(brut);
  } catch {
    return { accepte: false, motif: `JSON invalide ou tronqué — impossible de parser la sortie du modèle : « ${aperçu(brut)} »` };
  }
  if (!Array.isArray(tableau)) {
    return { accepte: false, motif: `la sortie doit être un tableau JSON de 0 à ${MAX_LECONS_PAR_PASSE} leçons` };
  }
  if (tableau.length > MAX_LECONS_PAR_PASSE) {
    return { accepte: false, motif: `au plus ${MAX_LECONS_PAR_PASSE} leçons par passe — reçu ${tableau.length}` };
  }
  const lecons: LeconExtraite[] = [];
  for (const [index, element] of tableau.entries()) {
    const resultat = validerLeconExtraite(JSON.stringify(element));
    if (!resultat.accepte) return { accepte: false, motif: `leçon #${index} rejetée : ${resultat.motif}` };
    lecons.push(resultat.valeur);
  }
  return { accepte: true, valeur: lecons };
}
