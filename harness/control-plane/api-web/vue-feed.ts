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

import type { DemandePermission } from '../bus-permissions/index.ts';
import type { Registre, Transition } from '../registre/index.ts';

export interface FeedEventApi {
  readonly ts: string;
  readonly type: 'permission' | 'activity' | 'system' | 'instruction';
  readonly text: string;
  readonly tool?: string;
  readonly auto?: boolean;
  readonly pending?: boolean;
  readonly resolved?: string;
  readonly path?: string;
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
 * `☠` Le contrat l'exige explicitement : TOUTE décision d'autorisation apparaît
 * ici, y compris celles que le lead a tranchées seul (H-64). C'est la trace
 * d'audit — le volume est voulu, pas un défaut à filtrer.
 */
function versEvenementPermission(d: DemandePermission): FeedEventApi {
  const permis = d.verdict === null ? null : d.verdict.behavior === 'allow';
  // `☠` `resolue_auto` : le lead a tranché SEUL (H-64). C'est justement ce que
  // l'opérateur ne verrait nulle part ailleurs — l'omettre viderait l'audit de
  // son intérêt.
  const auto = d.etat === 'resolue_auto';
  return {
    ts: horodatage(d.enAttenteDepuisA ?? d.recueA),
    type: 'permission',
    text: `${d.outil}${d.blockedPath !== undefined ? ` sur ${d.blockedPath}` : ''}${
      d.decisionReason !== undefined ? ` — ${d.decisionReason}` : ''
    }`,
    tool: d.outil,
    ...(d.etat === 'en_attente' ? { pending: true } : {}),
    ...(auto ? { auto: true } : {}),
    ...(permis !== null ? { resolved: permis ? 'autorisée' : 'refusée' } : {}),
    ...(d.blockedPath !== undefined ? { path: d.blockedPath } : {}),
  };
}

export interface SourceDemandes {
  /** Demandes connues pour un worker donné, en attente ou déjà tranchées. */
  parWorker(idWorker: string): readonly DemandePermission[];
}

/**
 * Fil complet d'une mission, du plus ancien au plus récent — l'interface fait
 * défiler vers le bas.
 */
export function construireFeed(
  registre: Registre,
  missionId: string,
  demandes?: SourceDemandes,
  limite = 200,
): readonly FeedEventApi[] {
  const evenements: FeedEventApi[] = registre.etats
    .historique(missionId, limite)
    .map(versEvenementTransition);

  // Ce que l'équipe a écrit — la seule chose que l'opérateur voulait vraiment lire.
  for (const a of registre.missions.activites(missionId, limite)) {
    evenements.push({ ts: horodatage(a.survenuA), type: 'activity', text: a.texte });
  }

  if (demandes !== undefined) {
    for (const d of demandes.parWorker(missionId)) evenements.push(versEvenementPermission(d));
  }

  // Tri sur l'horodatage textuel : format fixe `HH:MM:SS`, donc l'ordre
  // lexicographique EST l'ordre chronologique sur une même journée.
  return evenements.sort((a, b) => a.ts.localeCompare(b.ts));
}
