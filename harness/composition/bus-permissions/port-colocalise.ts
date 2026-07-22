/**
 * Responsabilité : implémentation RÉELLE de `PortBusPermissions`
 * (`workers/types.ts`, H-73.1) — le port que `canUseTool` d'un worker attend
 * pour router une demande redélivrée vers la machine à états du bus de
 * permissions (`control-plane/bus-permissions/`, M-21).
 *
 * `☠` LIMITE STRUCTURELLE À NE PAS MASQUER (voir rapport de mission) : ce
 * pont suppose que `MachineEtatsDemandes` vit dans LE MÊME PROCESS que le
 * worker qui l'appelle. C'est vrai dans un déploiement « tout-en-un » (Pi et
 * PC colocalisés), FAUX dans le déploiement cible (Pi/PC deux machines) — le
 * seul canal existant entre les deux (D.3, `superviseur/canal-controle.ts`)
 * est Pi→PC uniquement (D.3.2 : « le PC n'initie jamais »), alors que ce port
 * doit être appelé DEPUIS le worker (PC) et atteindre la machine (Pi) de
 * façon synchrone. Fermer cet écart pour de bon exige un nouveau canal
 * bidirectionnel initié par le PC — une décision d'architecture, pas un
 * câblage, hors mandat de cette mission (voir rapport, section « ce qui ne
 * s'assemble pas »).
 *
 * Ce fichier fournit donc la version qui compose RÉELLEMENT — testable,
 * correcte — pour le cas colocalisé, et documente explicitement ce qu'elle
 * NE couvre PAS.
 */

import type { MachineEtatsDemandes } from '../../control-plane/bus-permissions/index.ts';
// `☠` TROUVÉ EN ASSEMBLANT : `workers/index.ts` (interface publique du domaine)
// n'exporte PAS `DemandeCanUseTool`/`PortBusPermissions`/`VerdictCanUseTool` —
// pourtant nécessaires pour qu'un autre domaine puisse fournir ce port (H-73.1).
// Import direct depuis `types.ts` en attendant que `workers/index.ts` les
// expose (hors zone de cette mission — voir rapport, section « ce qui ne
// s'assemble pas »).
import type { DemandeCanUseTool, PortBusPermissions, VerdictCanUseTool } from '../../workers/types.ts';
import { compositionLogger } from '../logger.ts';

const log = compositionLogger.child({ composant: 'port-bus-permissions-colocalise' });

export interface OptionsPortBusPermissionsColocalise {
  readonly idWorker: string;
  /** Intervalle de scrutation pendant l'attente d'un verdict humain (ms). */
  readonly intervalleScrutationMs?: number;
  /** Budget total avant repli sur refus (ms) — doit rester sous le délai du worker (5 s, `can-use-tool.ts`). */
  readonly budgetMs?: number;
}

const INTERVALLE_SCRUTATION_MS_DEFAUT = 200;
const BUDGET_MS_DEFAUT = 4_000;

function attendre(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Construit le port. `machine` doit être L'INSTANCE réelle partagée avec le
 * reste du control-plane — jamais une nouvelle instance créée ici (elle ne
 * verrait aucune des demandes déjà connues).
 */
export function creerPortBusPermissionsColocalise(
  machine: MachineEtatsDemandes,
  options: OptionsPortBusPermissionsColocalise,
): PortBusPermissions {
  const intervalle = options.intervalleScrutationMs ?? INTERVALLE_SCRUTATION_MS_DEFAUT;
  const budget = options.budgetMs ?? BUDGET_MS_DEFAUT;

  return async (demande: DemandeCanUseTool): Promise<VerdictCanUseTool> => {
    const resultat = machine.redelivrer({
      requestId: demande.requestId,
      idWorker: options.idWorker,
      outil: demande.outil,
      decisionReason: demande.decisionReason,
      blockedPath: demande.blockedPath,
      agentId: demande.agentId,
    });

    if (resultat.action === 'verdict_a_reemettre') return resultat.verdict;
    if (resultat.action === 'refusee' || resultat.action === 'ignoree_pre_escalade') {
      return { behavior: 'deny', message: `demande « ${resultat.action} » par la machine à états (C.3, requestId ${demande.requestId})` };
    }

    // 'nouvelle_escalade' / 'deja_en_file' : un humain doit encore trancher.
    // Scrute l'état jusqu'au budget, sans jamais dépasser le délai propre du
    // worker (`CAN_USE_TOOL_PORT_TIMEOUT_MS`, 5 s) — voir `workers/can-use-tool.ts`.
    const echeance = Date.now() + budget;
    while (Date.now() < echeance) {
      await attendre(intervalle);
      const etat = machine.demande(demande.requestId);
      if (etat?.verdict !== null && etat?.verdict !== undefined) {
        machine.confirmer(demande.requestId);
        return etat.verdict;
      }
    }
    log.warn({ requestId: demande.requestId }, 'aucun verdict humain dans le budget imparti — refus par défaut, demande reste en attente côté bus');
    return { behavior: 'deny', message: `aucun verdict humain reçu dans le délai imparti (requestId ${demande.requestId}) — réessayer` };
  };
}
