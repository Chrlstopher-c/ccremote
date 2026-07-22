/**
 * Responsabilité : le rappel `canUseTool` fourni à tout worker (H-73.1, mission
 * de dette sur `pending_permission_requests`).
 *
 * ☠ Ce rappel n'est PAS un arbitre. En `permissionMode: 'auto'`, le classifieur
 * du lead tranche seul (H-64) et n'invoque jamais ce rappel en régime normal —
 * rien ici ne doit changer ce qui est autorisé ou refusé en régime nominal. Son
 * seul rôle : être PRÉSENT pour recevoir la redélivrance d'une demande en
 * attente après une reconnexion (`processPendingPermissionRequests` →
 * `handleControlRequest` → `processControlRequest`, lequel lève
 * `"canUseTool callback is not provided."` si le champ est absent). Sans lui,
 * la demande rejouée est perdue silencieusement (H-73.1).
 *
 * Comportement par défaut, en l'absence de port câblé ou en cas d'échec du
 * port (délai dépassé, exception) : REFUS explicite, jamais autorisation.
 *
 * Raisonnement (point de conception de cette mission) :
 *  - Accorder par défaut exécuterait une action qu'aucun arbitre — ni le
 *    classifieur, ni un humain — n'a validée. Sur un outil comme Bash, c'est
 *    irréversible par construction (le plancher de déni, C.1.3, ne couvre que
 *    des motifs scopés connus à l'avance, pas l'ensemble des demandes).
 *  - Refuser par défaut ne fait que retarder une reprise déjà en attente
 *    d'arbitrage : c'est réversible (le worker reçoit un `deny` avec un
 *    message actionnable, pas un blocage muet), visible dans les logs, et la
 *    demande reste disponible pour une redélivrance ultérieure une fois le
 *    port réellement câblé.
 *  - C'est aussi le principe que le SDK documente lui-même sur ce rappel :
 *    « Fail-closed: an accidental null means no control_response is sent and
 *    the tool stays blocked indefinitely ». Refuser explicitement plutôt que
 *    de risquer un blocage est la lecture cohérente de ce principe appliquée
 *    à l'absence de port.
 *
 * `☠` Ne bloque jamais indéfiniment (propriété n°1 du harness) : le port est
 * couru contre un délai fixe ; au-delà, refus par défaut. Le port peut lever,
 * ne jamais résoudre, ou résoudre tard — aucun de ces cas ne doit empêcher ce
 * rappel de répondre au SDK.
 *
 * `⚠` Ne réimplémente pas la déduplication des requêtes en vol : le SDK s'en
 * charge (H-73.1, point 5). Ce module ne fait que router et retomber sur un
 * refus sûr — la dédup des requêtes déjà résolues vit dans la machine à états
 * du bus (M-21), pas ici.
 */

import type { CanUseTool, PermissionResult } from '@anthropic-ai/claude-agent-sdk';
import { sessionLogger } from './logger.ts';
import type { DemandeCanUseTool, PortBusPermissions, VerdictCanUseTool, WorkerSpec } from './types.ts';

/** Au-delà, le port est considéré muet : refus par défaut plutôt qu'attente indéfinie. */
export const CAN_USE_TOOL_PORT_TIMEOUT_MS = 5_000;

const MESSAGE_SANS_PORT =
  "Aucun port vers le bus de permissions n'est câblé sur ce worker : cette demande " +
  'redélivrée ne peut pas être arbitrée ici. Réessaie une fois le bus connecté, ou ' +
  "attends une intervention humaine côté opérateur.";

const MESSAGE_PORT_EN_ECHEC =
  'Le port vers le bus de permissions a échoué (délai dépassé ou erreur) pour cette ' +
  'demande redélivrée. Réessaie une fois le bus disponible, ou attends une intervention ' +
  'humaine côté opérateur.';

function verdictParDefaut(message: string): VerdictCanUseTool {
  return { behavior: 'deny', message };
}

function versPermissionResult(verdict: VerdictCanUseTool, toolUseID: string): PermissionResult {
  return verdict.behavior === 'allow'
    ? { behavior: 'allow', updatedInput: verdict.updatedInput, toolUseID }
    : { behavior: 'deny', message: verdict.message, interrupt: verdict.interrupt, toolUseID };
}

/**
 * Court le port contre un délai fixe. Toute issue autre qu'une résolution
 * normale du port (délai dépassé, rejet) retombe sur le refus par défaut.
 */
async function resoudreViaPort(
  port: PortBusPermissions,
  demande: DemandeCanUseTool,
  log: ReturnType<typeof sessionLogger>,
): Promise<VerdictCanUseTool> {
  const delaiDepasse = Symbol('delai_depasse');
  try {
    const resultat = await Promise.race([
      port(demande),
      new Promise<typeof delaiDepasse>((resolve) => {
        setTimeout(() => resolve(delaiDepasse), CAN_USE_TOOL_PORT_TIMEOUT_MS);
      }),
    ]);
    if (resultat === delaiDepasse) {
      log.warn({ requestId: demande.requestId }, 'port bus permissions : délai dépassé, refus par défaut');
      return verdictParDefaut(MESSAGE_PORT_EN_ECHEC);
    }
    return resultat;
  } catch (error) {
    log.error({ err: error, requestId: demande.requestId }, 'port bus permissions a levé, refus par défaut');
    return verdictParDefaut(MESSAGE_PORT_EN_ECHEC);
  }
}

/**
 * Construit le rappel `canUseTool` d'un worker. Toujours fourni (H-73.1 point 1),
 * quel que soit `permissionMode` — voir l'en-tête du fichier pour le raisonnement.
 */
export function buildCanUseTool(spec: WorkerSpec): CanUseTool {
  const log = sessionLogger(spec.sessionId);
  return async (toolName, input, options): Promise<PermissionResult | null> => {
    const demande: DemandeCanUseTool = {
      requestId: options.requestId,
      outil: toolName,
      input,
      decisionReason: options.decisionReason,
      blockedPath: options.blockedPath,
      agentId: options.agentID,
    };
    log.info(
      { requestId: demande.requestId, outil: toolName },
      'canUseTool invoqué — redélivrance ou exception C.1.2',
    );
    try {
      const verdict =
        spec.portBusPermissions === undefined
          ? verdictParDefaut(MESSAGE_SANS_PORT)
          : await resoudreViaPort(spec.portBusPermissions, demande, log);
      return versPermissionResult(verdict, options.toolUseID);
    } catch (error) {
      log.error({ err: error, requestId: demande.requestId }, 'canUseTool a levé de façon inattendue, refus par défaut');
      return versPermissionResult(verdictParDefaut(MESSAGE_PORT_EN_ECHEC), options.toolUseID);
    }
  };
}
