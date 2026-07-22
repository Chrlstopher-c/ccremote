/**
 * Responsabilité : lecture défensive de la réponse de `Query.reinitialize()` (D.2.4).
 *
 * `⚠ HYP à vérifier sur banc réel` (voir le commentaire détaillé sur
 * `SuperviseurWorkers.reinitialiser`) : le type public `SDKControlInitializeResponse`
 * ne déclare pas `pending_permission_requests`, alors que les types de trame
 * internes du SDK (`ControlResponse`/`ControlErrorResponse`) le portent. Cette
 * fonction ne suppose NI qu'il est présent NI qu'il est absent : `unknown` +
 * narrowing (code-standards.md), jamais un cast non justifié.
 */

import type { DemandeEnAttenteReinitialisation } from '../control-plane/reconciliation/types.ts';

function estEnregistrement(valeur: unknown): valeur is Record<string, unknown> {
  return typeof valeur === 'object' && valeur !== null;
}

/**
 * `SDKControlRequest.request` porte `subtype`, et `tool_name` seulement quand
 * `subtype === 'can_use_tool'`. Pour tout autre subtype (initialize, interrupt,
 * dialogue…), le `subtype` lui-même sert d'étiquette — jamais inventée, jamais
 * vide.
 */
function extraireOutil(requete: unknown): string {
  if (!estEnregistrement(requete)) return '(forme inconnue)';
  const subtype = requete['subtype'];
  if (typeof subtype !== 'string') return '(subtype absent)';
  if (subtype !== 'can_use_tool') return subtype;
  const toolName = requete['tool_name'];
  return typeof toolName === 'string' ? toolName : 'can_use_tool';
}

function extraireUneDemande(brut: unknown): DemandeEnAttenteReinitialisation | null {
  if (!estEnregistrement(brut)) return null;
  const requestId = brut['request_id'];
  if (typeof requestId !== 'string') return null;
  return { requestId, outil: extraireOutil(brut['request']) };
}

/**
 * Lecture défensive de `pending_permission_requests` sur la réponse résolue de
 * `reinitialize()`. Absent (lecture (a) de l'HYP ci-dessus, la plus probable) ⇒
 * `[]`, jamais une exception. Présent au runtime malgré le type public plus
 * étroit (lecture (b)) ⇒ exploité.
 */
export function extraireDemandesEnAttente(reponse: unknown): readonly DemandeEnAttenteReinitialisation[] {
  if (!estEnregistrement(reponse)) return [];
  const brut = reponse['pending_permission_requests'];
  if (!Array.isArray(brut)) return [];
  const demandes: DemandeEnAttenteReinitialisation[] = [];
  for (const entree of brut) {
    const demande = extraireUneDemande(entree);
    if (demande !== null) demandes.push(demande);
  }
  return demandes;
}
