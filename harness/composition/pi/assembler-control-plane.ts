/**
 * Responsabilité : LA racine de composition du Pi — construit le graphe
 * d'objets réel du control plane (branches A/C/E/F, `03-couche-1.md`) et
 * démarre la session orchestrateur maître.
 *
 * Avant ce fichier, chaque module de branche avait ses tests et parfois un
 * banc `acceptation/*.ts` isolé, mais AUCUN exécutable ne les assemblait tous
 * ensemble avec des dépendances réelles (réseau vers le PC compris) — c'est
 * exactement le défaut décrit par la mission et par H-74.
 *
 * Garde-fous branchés ICI pour la première fois en production :
 *  - `LecteurUtilisationParc` réel (G.1.3) — H-74, occurrence n°2 ;
 *  - réconciliation (M-30) branchée sur un VRAI canal réseau vers le PC
 *    (`ClientSuperviseurPc`), au lieu de rester un contrat sans appelant
 *    (TODO.md, « ports non implémentés ») ;
 *  - bus de permissions (M-21) partagé entre la réconciliation et le serveur
 *    MCP de contrôle — une seule instance, jamais deux machines à états qui
 *    divergeraient silencieusement.
 */

import { ouvrirRegistre, type Registre } from '../../control-plane/registre/index.ts';
import { MachineEtatsDemandes } from '../../control-plane/bus-permissions/index.ts';
import { creerServeurMcpControle } from '../../control-plane/orchestrateur/mcp-controle/index.ts';
import {
  demarrerOrchestrateur,
  JournalIncidentsFichier,
  StockageIdentiteFichier,
  type PoigneeOrchestrateur,
} from '../../control-plane/orchestrateur/processus/index.ts';
import type { DependancesReconciliation } from '../../control-plane/reconciliation/index.ts';
import { compositionLogger } from '../logger.ts';
import { ClientSuperviseurPc } from './client-superviseur-pc.ts';
import { creerLecteurUtilisationParc } from './port-utilisation-parc.ts';
import { BUDGET_NON_CABLE, CIBLES_NON_CABLEES } from './ports-non-cables.ts';
import { creerVerificateurSessionSdk } from './verificateur-session-sdk.ts';

const log = compositionLogger.child({ composant: 'assembler-control-plane-pi' });

export interface OptionsAssemblageControlPlanePi {
  readonly cheminRegistreDb: string;
  readonly cheminIdentiteOrchestrateur: string;
  readonly cheminIncidentsOrchestrateur: string;
  readonly repertoireProjets: string;
  readonly cwdOrchestrateur: string;
  /** `ws://host:port` du canal de contrôle D.3 exposé par `bin-pc.ts`. */
  readonly urlSuperviseurPc: string;
  readonly configDirOrchestrateur?: string;
  readonly seuilUtilisationPctPlafondParc?: number;
}

export interface ControlPlanePiAssemble {
  readonly registre: Registre;
  readonly machineEtatsDemandes: MachineEtatsDemandes;
  readonly clientSuperviseurPc: ClientSuperviseurPc;
  readonly orchestrateur: PoigneeOrchestrateur;
}

function construireDependancesReconciliation(client: ClientSuperviseurPc, machine: MachineEtatsDemandes): DependancesReconciliation {
  return {
    inventairePc: client,
    reinitialisateur: client,
    busPermissions: {
      redelivrer: (entree): void => {
        machine.redelivrer(entree);
      },
    },
  };
}

/**
 * Construit le control plane complet ET démarre la session orchestrateur.
 * `☠` N'attend jamais l'établissement d'un premier échange — voir
 * `demarrage.ts` (H-62) : cette fonction rend la main dès que la session est
 * ouverte, pas quand elle a répondu.
 */
export async function assemblerControlPlanePi(options: OptionsAssemblageControlPlanePi): Promise<ControlPlanePiAssemble> {
  const registre = ouvrirRegistre({ chemin: options.cheminRegistreDb });
  const machineEtatsDemandes = new MachineEtatsDemandes();
  const clientSuperviseurPc = new ClientSuperviseurPc({ url: options.urlSuperviseurPc });

  const serveurControle = creerServeurMcpControle({
    registre,
    repertoireProjets: options.repertoireProjets,
    escalades: machineEtatsDemandes,
    cibles: CIBLES_NON_CABLEES,
    arreteur: clientSuperviseurPc,
    relanceur: clientSuperviseurPc,
    budget: BUDGET_NON_CABLE,
    utilisationParc: creerLecteurUtilisationParc(registre),
    configPlafondParc: { seuilUtilisationPct: options.seuilUtilisationPctPlafondParc },
  });

  const orchestrateur = await demarrerOrchestrateur({
    stockageIdentite: new StockageIdentiteFichier(options.cheminIdentiteOrchestrateur),
    verificateurSessionExistante: creerVerificateurSessionSdk(options.cwdOrchestrateur),
    serveurControle,
    registre,
    reconciliation: construireDependancesReconciliation(clientSuperviseurPc, machineEtatsDemandes),
    incidents: new JournalIncidentsFichier(options.cheminIncidentsOrchestrateur),
    cwd: options.cwdOrchestrateur,
    configDir: options.configDirOrchestrateur,
  });

  log.info({ sessionId: orchestrateur.sessionId }, 'control plane Pi assemblé et session orchestrateur établie');

  return { registre, machineEtatsDemandes, clientSuperviseurPc, orchestrateur };
}
