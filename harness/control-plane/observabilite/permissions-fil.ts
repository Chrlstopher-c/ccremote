/**
 * Responsabilité : le fil unique d'une mission (C.4.2, H-64) — active tissée
 * avec les permissions, `requires_action` visuellement distinct (acceptation b).
 *
 * H-64, mots de Chris : « c'est le leader qui gère [...] il faudrait plutôt
 * les logger quand on affiche la discussion en question ». Modèle retenu :
 *  - le fil de la mission porte TOUTES les autorisations, y compris
 *    auto-résolues par le lead (`estRequiresAction: false`) ;
 *  - seule une demande réellement ESCALADÉE à l'humain (bus-permissions,
 *    état `en_attente`) porte `estRequiresAction: true` — c'est le SEUL signal
 *    qui doit attirer l'œil (H-40 : le lead arbitre le reste en silence).
 *
 * Source d'exhaustivité : `EnregistrementAudit` (`audit-permissions`, C.1.1,
 * `PreToolUse`) — ne réimplémente pas la collecte, la met simplement en forme
 * de fil chronologique aux côtés de l'activité (E.2).
 */

import type { EnregistrementAudit } from '../audit-permissions/index.ts';
import type { DemandePermission } from '../bus-permissions/index.ts';
import { RACINE_FLUX } from './types.ts';
import type { EvenementFilMission, EvenementPermissionFil } from './types.ts';

/**
 * Construit les entrées « permission » du fil à partir de la trace d'audit
 * exhaustive, en marquant `estRequiresAction` d'après l'ensemble (généralement
 * petit, H-40) des demandes réellement en attente humaine.
 */
export function evenementsPermissionsFil(
  audit: readonly EnregistrementAudit[],
  enAttenteHumaine: readonly DemandePermission[],
): readonly EvenementFilMission[] {
  const idsEnAttente = new Set(enAttenteHumaine.map((d) => d.requestId));
  return audit
    .filter((e) => e.verdict !== 'indetermine' || idsEnAttente.has(e.toolUseId))
    .map((e) => construireEvenement(e, idsEnAttente.has(e.toolUseId)));
}

function construireEvenement(e: EnregistrementAudit, estRequiresAction: boolean): EvenementPermissionFil {
  return {
    nature: 'permission',
    ligneId: e.agentId ?? RACINE_FLUX,
    toolUseId: e.toolUseId,
    outil: e.outil,
    verdict: estRequiresAction ? 'indetermine' : verdictAffichable(e),
    auteur: e.auteur,
    horodatage: e.verdictA ?? e.tentativeVueA ?? 0,
    estRequiresAction,
  };
}

function verdictAffichable(e: EnregistrementAudit): 'autorise' | 'refuse' | 'indetermine' {
  return e.verdict;
}
