/**
 * Responsabilité : implémentation RÉELLE de `PortBusPermissions`
 * (`workers/types.ts`, H-73.1) pour le déploiement à DEUX machines — le
 * complément de `composition/bus-permissions/port-colocalise.ts` (valide
 * seulement en « tout-en-un »). C'est CE fichier qui ferme la limite que
 * `port-colocalise.ts` documentait explicitement comme non résolue : « fermer
 * cet écart pour de bon exige un nouveau canal bidirectionnel initié par le
 * PC » — exactement ce que H-75 construit.
 *
 * Envoie une enveloppe `permission_demande` sur le lien unique (`client-lien-
 * pi.ts`) et attend le `permission_verdict` corrélé, émis par
 * `composition/pi/permission-verdict-distant.ts` — potentiellement bien après
 * l'envoi si un humain doit arbitrer (voir ce fichier pour le budget réel).
 *
 * `☠` Budget local à CE port : DOIT rester sous `CAN_USE_TOOL_PORT_TIMEOUT_MS`
 * (`workers/can-use-tool.ts`) — au-delà, `buildCanUseTool` a déjà appliqué son
 * propre refus par défaut, et une réponse tardive de ce port serait ignorée
 * pour rien (voir `can-use-tool.ts`, comportement en son absence).
 */

import { CAN_USE_TOOL_PORT_TIMEOUT_MS } from '../../workers/can-use-tool.ts';
import type { DemandeCanUseTool, PortBusPermissions, VerdictCanUseTool } from '../../workers/types.ts';
import type { Lien } from '../../transport/contrat.ts';
import { compositionLogger } from '../logger.ts';
import { CorrelateurReponses } from '../lien-pc-pi/correlateur.ts';
import { envoyerEnveloppe, surEnveloppe, type EnveloppeLien } from '../lien-pc-pi/protocole.ts';

const log = compositionLogger.child({ composant: 'port-bus-permissions-distant' });

// Marge réseau sous le budget du worker : la réponse doit avoir une chance
// réelle de traverser le lien et d'être corrélée avant que `can-use-tool.ts`
// ne bascule sur son repli par défaut.
const MARGE_RESEAU_MS = 500;
const TIMEOUT_DEFAUT_MS = CAN_USE_TOOL_PORT_TIMEOUT_MS - MARGE_RESEAU_MS;

export interface OptionsPortBusPermissionsDistant {
  readonly timeoutMs?: number;
}

/**
 * `lien` DOIT être L'INSTANCE réelle partagée avec `client-lien-pi.ts` —
 * jamais une nouvelle instance : elle ne verrait aucun verdict déjà en transit.
 */
export function creerPortBusPermissionsDistant(lien: Lien, options: OptionsPortBusPermissionsDistant = {}): PortBusPermissions {
  const timeoutMs = options.timeoutMs ?? TIMEOUT_DEFAUT_MS;
  const correlateur = new CorrelateurReponses<VerdictCanUseTool>();

  surEnveloppe(
    lien.versPi(),
    (enveloppe) => surEnveloppeRecue(correlateur, enveloppe),
    (erreur) => log.error({ err: erreur }, 'enveloppe illisible reçue du Pi sur le canal de permissions'),
  );

  return async (demande: DemandeCanUseTool): Promise<VerdictCanUseTool> => {
    const id = correlateur.nouvelId();
    try {
      const attente = correlateur.attendre(id, timeoutMs);
      envoyerEnveloppe(lien.versPi(), { kind: 'permission_demande', id, demande });
      return await attente;
    } catch (erreur) {
      log.warn({ err: erreur, requestId: demande.requestId }, 'aucun verdict du Pi dans le budget — refus par défaut');
      return { behavior: 'deny', message: `aucun verdict reçu du Pi dans le délai imparti (requestId ${demande.requestId})` };
    }
  };
}

function surEnveloppeRecue(correlateur: CorrelateurReponses<VerdictCanUseTool>, enveloppe: EnveloppeLien): void {
  if (enveloppe.kind !== 'permission_verdict') return; // `controle_requete` : géré par canal-controle-recepteur.ts.
  correlateur.resoudre(enveloppe.id, enveloppe.verdict);
}
