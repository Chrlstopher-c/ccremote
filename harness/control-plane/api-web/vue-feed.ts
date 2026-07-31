/**
 * Responsabilité : construire le FIL d'une mission (`FeedEvent[]` du contrat
 * d'API) à partir des sources RÉELLES dont le Pi dispose — les transitions
 * d'état du registre et les demandes de permission du bus.
 *
 * `☠` Le fil était rendu VIDE jusqu'ici, par honnêteté : aucune source n'était
 * branchée. Le résultat, constaté le 23/07, est qu'une équipe pouvait travailler
 * pendant des minutes derrière un « 0 évènements » — l'opérateur n'avait
 * strictement aucun moyen de voir qu'il se passait quelque chose. Deux sources
 * existent pourtant déjà et sont persistées : on les rend.
 *
 * `☠` H-45 : jamais le flux brut du worker. Ce qui sort d'ici est un résumé
 * d'évènements de contrôle, jamais un transcript.
 */

import type { Registre, Transition } from '../registre/index.ts';

export interface FeedEventApi {
  readonly ts: string;
  readonly type: 'permission' | 'activity' | 'system' | 'instruction';
  readonly text: string;
  /**
   * Précision sur une `activity` : `reflexion` ou `outil`. Absent pour un texte.
   * `☠` Distingué plutôt que fondu dans `type` : l'UI n'affiche PAS une réflexion
   * comme une réponse, et le contrat existant ne doit pas changer de sens.
   */
  readonly nature?: 'reflexion' | 'outil';
  readonly tool?: string;
  readonly auto?: boolean;
  readonly pending?: boolean;
  readonly resolved?: string;
  readonly path?: string;
  /**
   * Sortie de l'outil, tronquée à la source (6 000 caractères).
   *
   * `☠` Absent tant que le résultat n'est pas revenu — et c'est une information
   * en soi : un appel sans sortie est un appel encore en vol, ou un worker mort
   * entre l'appel et sa réponse. L'interface distingue les deux cas, elle
   * n'affiche jamais un vide qui ressemblerait à « pas de sortie ».
   */
  readonly result?: string;
  readonly resultError?: boolean;
}

/** Le contrat impose `HH:MM:SS` — pas une date complète. */
function horodatage(ms: number): string {
  return new Date(ms).toTimeString().slice(0, 8);
}

/**
 * Traduit une transition en phrase lisible. `☠` L'origine compte autant que
 * l'état : « terminée (décidée par l'opérateur) » et « terminée (le worker a
 * rendu la main) » ne demandent pas la même réaction.
 */
function texteTransition(t: Transition): string {
  const passage = t.etatPrecedent === null ? t.etatNouveau : `${t.etatPrecedent} → ${t.etatNouveau}`;
  const motif = t.motif !== null && t.motif.length > 0 ? ` — ${t.motif}` : '';
  return `[${t.origine}] ${passage}${motif}`;
}

function versEvenementTransition(t: Transition): FeedEventApi {
  return { ts: horodatage(t.survenuA), type: 'system', text: texteTransition(t) };
}

/**
 * Fil complet d'une mission, du plus ancien au plus récent — l'interface fait
 * défiler vers le bas.
 */
export function construireFeed(
  registre: Registre,
  missionId: string,
  limite = 200,
): readonly FeedEventApi[] {
  const evenements: FeedEventApi[] = registre.etats
    .historique(missionId, limite)
    .map(versEvenementTransition);

  // Ce que l'équipe FAIT et ÉCRIT : réflexions, appels d'outils, textes. `☠` Sans
  // les outils et les réflexions, le fil restait figé sur « sdk running » pendant
  // qu'une équipe cherchait plusieurs minutes (23/07).
  for (const a of registre.missions.activites(missionId, limite)) {
    evenements.push({
      ts: horodatage(a.survenuA),
      type: 'activity',
      text: a.texte,
      ...(a.outil !== null ? { tool: a.outil } : {}),
      ...(a.type !== 'texte' ? { nature: a.type } : {}),
      ...(a.resultat ? { result: a.resultat, resultError: a.resultatErreur === true } : {}),
    });
  }


  // Tri sur l'horodatage textuel : format fixe `HH:MM:SS`, donc l'ordre
  // lexicographique EST l'ordre chronologique sur une même journée.
  return evenements.sort((a, b) => a.ts.localeCompare(b.ts));
}
