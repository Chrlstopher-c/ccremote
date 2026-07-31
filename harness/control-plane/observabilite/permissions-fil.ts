/**
 * Responsabilité : le fil unique d'une mission (C.4.2, H-64) — active tissée
 * avec les permissions, `requires_action` visuellement distinct (acceptation b).
 *
 * H-64, mots de Chris : « c'est le leader qui gère [...] il faudrait plutôt
 * les logger quand on affiche la discussion en question ». Modèle retenu :
 *  - le fil de la mission porte TOUTES les autorisations, toutes tranchées par
 *    le lead lui-même (H-40).
 *
 * `☠` `estRequiresAction` valait `true` pour une demande escaladée à l'humain.
 * Le bus d'escalade a été retiré le 2026-07-31 (aucune demande n'y est jamais
 * arrivée : en `permissionMode: 'auto'` le SDK n'appelle pas `canUseTool`), donc
 * plus rien ne peut porter ce marqueur. Il reste dans le type d'évènement, à
 * `false` — le retirer changerait un contrat d'affichage pour rien.
 *
 * Source d'exhaustivité : `EnregistrementAudit` (`audit-permissions`, C.1.1,
 * `PreToolUse`) — ne réimplémente pas la collecte, la met simplement en forme
 * de fil chronologique aux côtés de l'activité (E.2).
 */

import type { EnregistrementAudit } from '../audit-permissions/index.ts';
import { RACINE_FLUX } from './types.ts';
import type { EvenementFilMission, EvenementPermissionFil } from './types.ts';

/** Construit les entrées « permission » du fil à partir de la trace d'audit. */
export function evenementsPermissionsFil(
  audit: readonly EnregistrementAudit[],
): readonly EvenementFilMission[] {
  return audit.filter((e) => e.verdict !== 'indetermine').map((e) => construireEvenement(e, false));
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
