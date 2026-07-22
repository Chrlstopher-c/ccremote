/**
 * Responsabilité : construire le contrat de retour uniforme (A.2.3). Un seul
 * point de construction évite qu'un outil oublie un champ obligatoire (comme
 * `raison` sur un refus) — la forme correcte devient la voie la plus courte.
 */

import type { ContratRetour } from './types.ts';

export function applique(intention: string, etat?: string, ref?: string): ContratRetour {
  return { ok: true, intention, effet: 'applique', ...(etat !== undefined && { etat }), ...(ref !== undefined && { ref }) };
}

/** `'accepte'` = pris en compte, pas terminé (A.2.3) — jamais utilisé pour un travail fini. */
export function accepte(intention: string, ref: string, etat?: string): ContratRetour {
  return { ok: true, intention, effet: 'accepte', ref, ...(etat !== undefined && { etat }) };
}

/** `raison` est obligatoire ici — jamais un refus muet (A.2.3). */
export function refuse(intention: string, raison: string): ContratRetour {
  return { ok: false, intention, effet: 'refuse', raison };
}

/**
 * H-61 : rien n'est créé. `ref` identifie la proposition, `etat` porte le
 * mandat proposé — l'UI la présente à l'approbation humaine, ce module ne
 * décide jamais lui-même de la déclencher.
 */
export function differe(intention: string, ref: string, etat: string): ContratRetour {
  return { ok: true, intention, effet: 'differe', ref, etat };
}

/**
 * Filet ultime (A.2.4, d) : un outil ne lève jamais vers le modèle. Toute
 * exception inattendue (port qui throw, bug de sérialisation) retombe ici
 * plutôt que de remonter — au prix, assumé, de perdre le détail de la cause
 * dans le contrat (elle reste en revanche dans le journal pino de l'appelant).
 */
export function echecInattendu(intention: string, erreur: unknown): ContratRetour {
  return refuse(intention, `échec inattendu : ${erreur instanceof Error ? erreur.message : String(erreur)}`);
}
