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
 *
 * `☠ H-75` — le Pi HÉBERGE désormais le lien (`serveur-lien-pc.ts`), le PC
 * INITIE (`composition/pc/client-lien-pi.ts`). `ClientSuperviseurPc` et
 * `permission-verdict-distant.ts` partagent la MÊME instance de
 * `LienWebSocket` (`serveurLien.lien`) — jamais deux liens, conformément au
 * mandat (« un seul lien, décidé par l'opérateur »). La réconciliation
 * `'reconnexion'` (epoch incrémenté à chaque rattachement, D.2.3) est câblée
 * sur CHAQUE connexion PC acceptée, pas seulement au démarrage du Pi — voir
 * `reconciliation-sur-rattachement.ts`.
 */

import { demarrerServeurApiWeb, type ServeurApiWeb } from '../../control-plane/api-web/index.ts';
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
import { cablerPermissionVerdictDistant } from './permission-verdict-distant.ts';
import { creerDeclencheurReconciliationSurRattachement } from './reconciliation-sur-rattachement.ts';
import { demarrerServeurLienPc, type ServeurLienPc } from './serveur-lien-pc.ts';
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
  /** Port d'écoute du lien Pi↔PC (H-75 — le Pi héberge). */
  readonly portLienPc: number;
  readonly hostnameLienPc?: string;
  /** Secret partagé, lu depuis l'environnement par l'appelant — jamais codé en dur. */
  readonly secretLienPc: string;
  /** Port de l'API web servie à `pi-web` — toujours sur `127.0.0.1`. */
  readonly portApiWeb: number;
  readonly configDirOrchestrateur?: string;
  readonly seuilUtilisationPctPlafondParc?: number;
  /**
   * Démarre la session orchestrateur maître. `☠` Par défaut FAUX : cette
   * session consomme du quota en continu et exige des credentials Claude
   * valides sur le Pi. Le reste du control plane — parc, escalades, pilotage,
   * lien vers le PC — n'en dépend en RIEN : l'opérateur pilote ses missions
   * même sans elle. La coupler d'office rendrait tout le produit tributaire
   * d'un `/login` sur le Pi.
   */
  readonly avecOrchestrateur?: boolean;
}

export interface ControlPlanePiAssemble {
  readonly registre: Registre;
  readonly machineEtatsDemandes: MachineEtatsDemandes;
  readonly clientSuperviseurPc: ClientSuperviseurPc;
  readonly serveurLien: ServeurLienPc;
  readonly serveurApiWeb: ServeurApiWeb;
  /** `null` quand `avecOrchestrateur` est faux — voir cette option. */
  readonly orchestrateur: PoigneeOrchestrateur | null;
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

  // `☠` Le déclencheur de réconciliation est câblé APRÈS `dependancesReconciliation`
  // (qui a besoin de `clientSuperviseurPc`), mais `demarrerServeurLienPc` doit
  // recevoir le callback AVANT qu'une connexion n'arrive. Indirection par
  // référence mutable : `serveurLien.lien` existe dès la construction, seule
  // l'affectation du déclencheur est différée de quelques lignes.
  let declencheurReconciliation: (() => void) | null = null;
  const serveurLien = demarrerServeurLienPc({
    port: options.portLienPc,
    hostname: options.hostnameLienPc,
    secret: options.secretLienPc,
    surConnexionAcceptee: () => declencheurReconciliation?.(),
  });

  const clientSuperviseurPc = new ClientSuperviseurPc(serveurLien.lien);
  cablerPermissionVerdictDistant(machineEtatsDemandes, serveurLien.lien);

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

  // `☠` `pcEnLigne` est branché sur l'ÉTAT RÉEL du lien, jamais sur un drapeau
  // tenu à la main : c'est ce qui fait que l'interface dit « PC éteint » parce
  // qu'il l'est, et non parce qu'un booléen a été oublié quelque part.
  const serveurApiWeb = demarrerServeurApiWeb({
    port: options.portApiWeb,
    registre,
    escalades: machineEtatsDemandes,
    pcEnLigne: () => serveurLien.lien.etat() === 'ouvert',
    // `☠` Les ordres partent par le MÊME lien que le reste (H-75, un seul
    // lien). `arretUrgence` n'est pas exposé par `ClientSuperviseurPc` : le
    // chemin G.4 passe par le canal de contrôle et n'a pas encore de méthode
    // ici — l'omettre fait répondre 501, jamais un faux succès.
    pc: {
      arreter: (missionId) => clientSuperviseurPc.arreter(missionId),
      envoyerInstruction: (missionId, texte) => clientSuperviseurPc.envoyerInstruction(missionId, texte),
      mettreEnPause: (missionId) => clientSuperviseurPc.mettreEnPause(missionId),
      reprendre: (missionId) => clientSuperviseurPc.reprendre(missionId),
    },
  });

  const dependancesReconciliation = construireDependancesReconciliation(clientSuperviseurPc, machineEtatsDemandes);
  declencheurReconciliation = creerDeclencheurReconciliationSurRattachement(registre, dependancesReconciliation);

  if (options.avecOrchestrateur !== true) {
    log.warn(
      {},
      'control plane assemblé SANS session orchestrateur (avecOrchestrateur absent) — parc, escalades et pilotage restent pleinement opérationnels ; seule la vue conversation est inactive',
    );
    return { registre, machineEtatsDemandes, clientSuperviseurPc, serveurLien, serveurApiWeb, orchestrateur: null };
  }

  const orchestrateur = await demarrerOrchestrateur({
    stockageIdentite: new StockageIdentiteFichier(options.cheminIdentiteOrchestrateur),
    verificateurSessionExistante: creerVerificateurSessionSdk(options.cwdOrchestrateur),
    serveurControle,
    registre,
    reconciliation: dependancesReconciliation,
    incidents: new JournalIncidentsFichier(options.cheminIncidentsOrchestrateur),
    cwd: options.cwdOrchestrateur,
    configDir: options.configDirOrchestrateur,
  });

  log.info({ sessionId: orchestrateur.sessionId }, 'control plane Pi assemblé et session orchestrateur établie');

  return { registre, machineEtatsDemandes, clientSuperviseurPc, serveurLien, serveurApiWeb, orchestrateur };
}
