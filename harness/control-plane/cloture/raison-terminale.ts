/**
 * Responsabilité : nommer la VRAIE raison d'une clôture, à partir du dernier texte
 * produit par la mission. Pur, aucune I/O — même patron que `politique-cloture.ts`.
 *
 * `☠` Chantier 3 (21/08) : `derniere_raison_terminale` vaut `fantome_reconciliation`
 * sur 365 missions du parc réel sur 393 — c'est-à-dire rien, la colonne existe et
 * ne dit jamais pourquoi. Mesuré sur une copie de la base de production : le
 * dernier texte de certaines missions est littéralement « You've hit your session
 * limit · resets 8:10am (Europe/Paris) » — la cause est ÉCRITE, seulement jamais
 * relue. Ce module la relit.
 *
 * `☠ FAUX POSITIF ÉVITÉ` : une mission d'audit du parc a écrit un rapport de fin de
 * 20 630 caractères qui CITE la phrase « session limit » en exemple, dans son
 * propre texte. Un `LIKE '%session limit%'` sur un texte de cette taille l'aurait
 * classée à tort comme coupée par le quota — c'est un rapport de fin parfaitement
 * rendu. D'où la borne de taille : le message de coupure réel que le SDK injecte
 * est court (mesuré : 60 caractères), jamais une synthèse.
 */

/** Un texte plus long qu'un message de coupure n'EST plus un message de coupure — c'est un rapport qui en parle. */
const TAILLE_MAX_MESSAGE_COUPURE = 300;

export type RaisonCoupure = 'plafond_quota' | 'budget_epuise';

/** Motifs observés réellement en production (mandat chantier 3, 21/08) — pas une liste exhaustive. */
const MOTIFS_PLAFOND_QUOTA = [/session limit/i, /usage limit/i];
const MOTIFS_BUDGET_EPUISE = [/budget (quasi )?épuisé/i, /plafond (quasi )?atteint/i, /plafond épuisé/i];

/**
 * Raison de coupure détectable dans le DERNIER texte d'une mission, ou `null` si
 * rien de reconnu — auquel cas la mission reste « coupée sans cause identifiée »,
 * jamais forcée dans l'une de ces deux cases par défaut.
 */
export function detecterRaisonCoupure(dernierTexte: string | null): RaisonCoupure | null {
  if (dernierTexte === null) return null;
  const texte = dernierTexte.trim();
  if (texte.length === 0 || texte.length > TAILLE_MAX_MESSAGE_COUPURE) return null;
  if (MOTIFS_PLAFOND_QUOTA.some((motif) => motif.test(texte))) return 'plafond_quota';
  if (MOTIFS_BUDGET_EPUISE.some((motif) => motif.test(texte))) return 'budget_epuise';
  return null;
}

/** Raison écrite quand aucune cause précise n'est reconnue — jamais `fantome_reconciliation`, qui ne dit rien. */
export const RAISON_CLOTURE_SANS_RAPPORT = 'cloture_sans_rapport';
