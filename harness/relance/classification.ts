/**
 * Responsabilité : classifier une sortie de tour (`terminal_reason`) selon la table de
 * B.3.2, sans jamais inventer de catégorie (mission M-34, acceptation (a)).
 *
 * Source qui fait foi : `Upgrade/05-arbre-B-workers.md` § B.3.2, elle-même vérifiée contre
 * `TerminalReason` du SDK `0.3.217`. `Upgrade/01-verification-sdk.md` ne liste que neuf des
 * dix-neuf valeurs (« TerminalReason énumère les causes d'arrêt de boucle — **dont**
 * budget_exhausted, max_turns… ») : une énumération partielle, pas la table. B.3.2 est la
 * table complète, vérifiée en seconde passe, et c'est mon unique fichier de branche.
 *
 * `☠ CASSE` (piège documenté du brief) — trois valeurs du type SDK n'apparaissent dans
 * AUCUN des six groupes de B.3.2 : `image_error`, `tool_deferred`, `tool_deferred_unavailable`.
 * Leur inventer un groupe serait exactement la taxonomie maison interdite. Elles tombent
 * donc dans `non_couverte` : journalisées telles quelles, jamais relancées par défaut,
 * toujours remontées. `⚠ HYP fausse à signaler` si une lecture ultérieure du paquet leur
 * trouve un groupe explicite — voir le rapport de mission.
 */

import type { TerminalReason } from '@anthropic-ai/claude-agent-sdk';
import type { ClassificationTerminaison, GroupeTerminaison } from './types.ts';

/** Table exhaustive de B.3.2 — seule source de vérité pour le regroupement. */
const GROUPE_PAR_RAISON: Readonly<Record<TerminalReason, GroupeTerminaison>> = {
  completed: 'fin_normale',

  max_turns: 'borne_atteinte',
  budget_exhausted: 'borne_atteinte',

  aborted_streaming: 'volontaire',
  aborted_tools: 'volontaire',
  hook_stopped: 'volontaire',
  stop_hook_prevented: 'volontaire',
  background_requested: 'volontaire',

  api_error: 'transitoire',
  model_error: 'transitoire',
  turn_setup_failed: 'transitoire',

  prompt_too_long: 'structurel',
  malformed_tool_use_exhausted: 'structurel',
  structured_output_retry_exhausted: 'structurel',

  blocking_limit: 'quota',
  rapid_refill_breaker: 'quota',

  // Piège documenté ci-dessus : connues du SDK, absentes de la table de groupement de B.3.2.
  image_error: 'non_couverte',
  tool_deferred: 'non_couverte',
  tool_deferred_unavailable: 'non_couverte',
};

/** Les 19 valeurs vérifiées du type SDK — sert à distinguer « connue non couverte » de « inconnue ». */
const RAISONS_CONNUES: ReadonlySet<string> = new Set(Object.keys(GROUPE_PAR_RAISON));

/** Seul groupe relançable automatiquement en v1 (acceptation (b), (c)). */
const GROUPES_RELANCABLES: ReadonlySet<GroupeTerminaison> = new Set<GroupeTerminaison>(['transitoire']);

function estTerminalReasonConnue(valeur: string): valeur is TerminalReason {
  return RAISONS_CONNUES.has(valeur);
}

/**
 * Classifie une raison de terminaison brute.
 *
 * `raison` est typé `string | undefined` et non `TerminalReason | undefined` : le champ est
 * optionnel côté SDK (`SDKResultSuccess.terminal_reason?`), et une valeur non reconnue doit
 * pouvoir être journalisée telle quelle plutôt que rejetée par le système de types avant
 * même d'atteindre le journal (piège « raison inconnue traitée en silence »).
 */
export function classifierTerminaison(raison: string | undefined): ClassificationTerminaison {
  const raisonBrute = raison ?? '(absente)';

  if (raison === undefined || !estTerminalReasonConnue(raison)) {
    return { raisonBrute, raisonConnue: null, groupe: 'non_couverte', relancable: false };
  }

  const groupe = GROUPE_PAR_RAISON[raison];
  return { raisonBrute, raisonConnue: raison, groupe, relancable: GROUPES_RELANCABLES.has(groupe) };
}

/** Exposé pour les tests de table : vérifie que les 19 valeurs SDK sont couvertes sans exception. */
export function raisonsConnues(): readonly string[] {
  return [...RAISONS_CONNUES];
}
