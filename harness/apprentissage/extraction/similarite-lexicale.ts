/**
 * Responsabilité : rapprocher deux énoncés de leçon par similarité LEXICALE — pure, sans
 * modèle, sans I/O (C-5, SPEC §5 : « le rapprochement est d'abord lexical … et n'appelle le
 * modèle que pour départager les cas ambigus »). Un 8B — ou Haiku — n'est pas nécessaire pour
 * reconnaître deux phrases quasi identiques ; ce module tranche seul les cas nets et ne
 * laisse remonter à `rapprochement.ts` que la zone grise.
 *
 * `☠` Trigrammes de CARACTÈRES, pas de mots : un rapprochement mot-à-mot est cassé par la
 * moindre reformulation ou le moindre réordonnancement (mesuré en écrivant les tests de
 * cette étape — deux paraphrases légitimes tombaient à une similarité quasi nulle en
 * bigrammes de mots). Les trigrammes de caractères restent robustes à ces variations tout
 * en séparant nettement un match net d'un cas sans rapport.
 *
 * Conception inspirée de Hermes Agent (Nous Research) — MIT. Transposition indépendante en TypeScript.
 */

/** Au-dessus : match net, tranché ici sans appeler le modèle. */
export const SEUIL_SIMILARITE_FORTE = 0.6;
/** En-dessous : aucun rapport, tranché ici sans appeler le modèle. */
export const SEUIL_SIMILARITE_FAIBLE = 0.25;

/** Marqueurs de négation français les plus courants dans un énoncé d'une phrase. */
const MARQUEURS_NEGATION = [' ne ', " n'", ' pas', ' jamais', ' aucun', ' aucune', ' sans '] as const;

/** Diacritiques combinants Unicode (U+0300–U+036F), retirés après `normalize('NFD')`. */
const DIACRITIQUES_COMBINANTS = /[̀-ͯ]/g;

const TAILLE_NGRAMME = 3;

/** Normalise : minuscules, accents retirés, ponctuation réduite à des espaces. */
export function normaliser(texte: string): string {
  return ` ${texte
    .normalize('NFD')
    .replace(DIACRITIQUES_COMBINANTS, '')
    .toLowerCase()
    .replace(/[^a-z0-9']+/g, ' ')
    .trim()} `;
}

/** Trigrammes de caractères du texte normalisé. */
function trigrammes(texteNormalise: string): ReadonlySet<string> {
  const ensemble = new Set<string>();
  for (let i = 0; i <= texteNormalise.length - TAILLE_NGRAMME; i += 1) {
    ensemble.add(texteNormalise.slice(i, i + TAILLE_NGRAMME));
  }
  return ensemble;
}

function jaccard(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let intersection = 0;
  for (const element of a) if (b.has(element)) intersection += 1;
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/** Similarité lexicale [0, 1] entre deux énoncés — normalisation + Jaccard sur trigrammes de caractères. */
export function similarite(a: string, b: string): number {
  return jaccard(trigrammes(normaliser(a)), trigrammes(normaliser(b)));
}

/** `true` si l'énoncé porte au moins un marqueur de négation française. */
function porteUneNegation(texteNormalise: string): boolean {
  return MARQUEURS_NEGATION.some((marqueur) => texteNormalise.includes(marqueur));
}

/**
 * Heuristique déterministe pour un match lexical FORT (SEUIL_SIMILARITE_FORTE ou plus) :
 * deux énoncés très proches dont un seul porte une négation parlent, le plus souvent, de la
 * même chose en sens contraire (« Playwright fonctionne » / « Playwright ne fonctionne pas »).
 */
export function negationDivergente(a: string, b: string): boolean {
  return porteUneNegation(normaliser(a)) !== porteUneNegation(normaliser(b));
}
