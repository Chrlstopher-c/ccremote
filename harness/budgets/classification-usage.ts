/**
 * Responsabilité : classifier un texte de bannière/notification SDK selon les trois
 * catégories de G.1.4/E.4.3 (mission M-51, acceptation (c)).
 *
 * Source qui fait foi : les constantes exportées par le SDK lui-même
 * (`USAGE_LIMIT_ERROR_PREFIXES`, `USAGE_TRANSITION_PREFIXES`, `USAGE_WARNING_PREFIXES`,
 * `01-verification-sdk.md` Inventaire vérifié — Diagnostic). `⚠ ALPHA` sur le SDK :
 * isolé derrière ce seul fichier, jamais réimporté ailleurs directement.
 *
 * Porteurs observés du texte (vérifié dans `sdk.d.ts`) : `SDKInformationalMessage.content`
 * (`type:'system', subtype:'informational'`) et `SDKNotificationMessage.text`
 * (`type:'system', subtype:'notification'`) — les deux sont documentés comme
 * « Toast only » / « Footer/toast only » dans le SDK, exactement la nature des trois
 * groupes de préfixes.
 *
 * `☠ CASSE` (panne #16) — l'ordre de vérification compte : une limite RÉELLEMENT
 * atteinte est vérifiée en premier. Un texte ne doit jamais retomber sur une catégorie
 * moins sévère par accident de préfixe partagé.
 */

import {
  USAGE_LIMIT_ERROR_PREFIXES,
  USAGE_TRANSITION_PREFIXES,
  USAGE_WARNING_PREFIXES,
} from '@anthropic-ai/claude-agent-sdk';
import type { ClassificationMessageUsage } from './types.ts';

function trouvePrefixe(texte: string, prefixes: readonly string[]): string | null {
  return prefixes.find((prefixe) => texte.startsWith(prefixe)) ?? null;
}

/** Classifie un texte brut. Jamais d'exception : un texte inconnu retombe sur `aucune`. */
export function classifierMessageUsage(texteBrut: string): ClassificationMessageUsage {
  const erreur = trouvePrefixe(texteBrut, USAGE_LIMIT_ERROR_PREFIXES);
  if (erreur !== null) return { categorie: 'limite_atteinte', prefixe: erreur, texteBrut };

  const transition = trouvePrefixe(texteBrut, USAGE_TRANSITION_PREFIXES);
  if (transition !== null) return { categorie: 'transition', prefixe: transition, texteBrut };

  const avertissement = trouvePrefixe(texteBrut, USAGE_WARNING_PREFIXES);
  if (avertissement !== null) return { categorie: 'avertissement', prefixe: avertissement, texteBrut };

  return { categorie: 'aucune', prefixe: null, texteBrut };
}

/** Exposé pour les tests de table : vérifie que chaque préfixe SDK est bien couvert. */
export function prefixesConnus(): {
  readonly limite: readonly string[];
  readonly transition: readonly string[];
  readonly avertissement: readonly string[];
} {
  return {
    limite: USAGE_LIMIT_ERROR_PREFIXES,
    transition: USAGE_TRANSITION_PREFIXES,
    avertissement: USAGE_WARNING_PREFIXES,
  };
}
