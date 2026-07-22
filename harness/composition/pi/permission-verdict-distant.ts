/**
 * Responsabilité : ferme, pour le déploiement RÉEL à deux machines, la limite
 * documentée dans `composition/bus-permissions/port-colocalise.ts` — « ce
 * pont suppose que `MachineEtatsDemandes` vit dans LE MÊME PROCESS que le
 * worker qui l'appelle ». H-75 est précisément la mission qui ouvre le canal
 * bidirectionnel manquant : ce fichier, côté Pi, reçoit les enveloppes
 * `permission_demande` émises par `composition/pc/port-bus-permissions-
 * distant.ts` sur le lien unique, interroge la VRAIE `MachineEtatsDemandes`
 * du control plane, et pousse le `permission_verdict` — immédiatement si déjà
 * tranché, ou après une attente courte si un humain doit encore arbitrer.
 *
 * `☠` Le lien est un simple tuyau d'octets, pas un aller-retour HTTP : rien
 * n'empêche ce module de répondre BIEN APRÈS l'arrivée de la demande — c'est
 * le corrélateur côté PC (`port-bus-permissions-distant.ts`) qui matche par
 * `id`, pas un timing de requête/réponse. Le budget d'attente ici doit rester
 * SOUS `CAN_USE_TOOL_PORT_TIMEOUT_MS` (5 s, `workers/can-use-tool.ts`) moins
 * la marge réseau, sans quoi le PC aura déjà basculé sur son propre refus par
 * défaut avant que ce module ne réponde — la réponse tardive est alors
 * silencieusement ignorée côté PC (voir `CorrelateurReponses`), jamais
 * appliquée à une décision déjà prise.
 */

import type { MachineEtatsDemandes } from '../../control-plane/bus-permissions/index.ts';
import type { Lien } from '../../transport/contrat.ts';
import type { VerdictCanUseTool } from '../../workers/types.ts';
import { compositionLogger } from '../logger.ts';
import { envoyerEnveloppe, surEnveloppe, type EnveloppeLien } from '../lien-pc-pi/protocole.ts';

const log = compositionLogger.child({ composant: 'permission-verdict-distant' });

const INTERVALLE_SCRUTATION_MS_DEFAUT = 200;
const BUDGET_MS_DEFAUT = 3_500; // sous les 5 s de `CAN_USE_TOOL_PORT_TIMEOUT_MS`, marge réseau incluse.

export interface OptionsPermissionVerdictDistant {
  readonly intervalleScrutationMs?: number;
  readonly budgetMs?: number;
}

function attendre(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Câble la réception des `permission_demande` sur `lien.versPi()` (voir
 * `client-superviseur-pc.ts` pour la limite mesurée sur `versPc()` — jamais
 * de chemin de réception câblé dans `transport/`).
 */
export function cablerPermissionVerdictDistant(
  machine: MachineEtatsDemandes,
  lien: Lien,
  options: OptionsPermissionVerdictDistant = {},
): void {
  const intervalle = options.intervalleScrutationMs ?? INTERVALLE_SCRUTATION_MS_DEFAUT;
  const budget = options.budgetMs ?? BUDGET_MS_DEFAUT;

  surEnveloppe(
    lien.versPi(),
    (enveloppe) => void traiterDemande(machine, lien, enveloppe, intervalle, budget),
    (erreur) => log.error({ err: erreur }, 'enveloppe illisible reçue du PC sur le canal de permissions'),
  );
}

async function traiterDemande(
  machine: MachineEtatsDemandes,
  lien: Lien,
  enveloppe: EnveloppeLien,
  intervalle: number,
  budget: number,
): Promise<void> {
  if (enveloppe.kind !== 'permission_demande') return; // `controle_requete` : géré par canal-controle-recepteur.ts.
  const { id, demande } = enveloppe;

  const resultat = machine.redelivrer({
    requestId: demande.requestId,
    idWorker: 'pc', // un seul PC en v1 (H-56) — identifiant stable, pas encore multi-PC.
    outil: demande.outil,
    decisionReason: demande.decisionReason,
    blockedPath: demande.blockedPath,
    agentId: demande.agentId,
  });

  if (resultat.action === 'verdict_a_reemettre') {
    repondre(lien, id, resultat.verdict);
    return;
  }
  if (resultat.action === 'refusee' || resultat.action === 'ignoree_pre_escalade') {
    repondre(lien, id, { behavior: 'deny', message: `demande « ${resultat.action} » par la machine à états (C.3, requestId ${demande.requestId})` });
    return;
  }

  // 'nouvelle_escalade' / 'deja_en_file' : un humain doit encore trancher.
  const echeance = Date.now() + budget;
  while (Date.now() < echeance) {
    await attendre(intervalle);
    const etat = machine.demande(demande.requestId);
    if (etat?.verdict !== null && etat?.verdict !== undefined) {
      machine.confirmer(demande.requestId);
      repondre(lien, id, etat.verdict);
      return;
    }
  }
  log.warn({ requestId: demande.requestId }, 'aucun verdict humain dans le budget imparti côté Pi — refus par défaut envoyé au PC');
  repondre(lien, id, { behavior: 'deny', message: `aucun verdict humain reçu dans le délai imparti (requestId ${demande.requestId})` });
}

function repondre(lien: Lien, id: string, verdict: VerdictCanUseTool): void {
  envoyerEnveloppe(lien.versPi(), { kind: 'permission_verdict', id, verdict });
}
