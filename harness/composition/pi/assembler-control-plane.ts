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
 *
 * `☠ H-75` — le Pi HÉBERGE le lien (`serveur-lien-pc.ts`), les machines de
 * travail INITIENT (`composition/pc/client-lien-pi.ts`). La réconciliation
 * `'reconnexion'` (epoch incrémenté à chaque rattachement, D.2.3) est câblée
 * sur CHAQUE connexion acceptée, pas seulement au démarrage du Pi — voir
 * `reconciliation-sur-rattachement.ts`.
 *
 * `☠ V2 (2026-08-01) — PLUSIEURS MACHINES DE TRAVAIL.` Ce fichier tenait UN
 * `ClientSuperviseurPc` qu'il passait à ses six consommateurs : « le PC » était
 * un singulier de fait, et il n'existait nulle part où poser la question
 * « lequel ? ». Il tient maintenant un `ParcSuperviseurs`
 * (`parc-superviseurs.ts`), un client par machine identifiée, construit à la
 * PREMIÈRE connexion de chacune. Ce qui change en pratique : le PC de Chris et
 * le VPS OVH peuvent travailler EN MÊME TEMPS sur des projets différents, là où
 * l'un devait être éteint pour laisser vivre l'autre.
 *
 * `☠` Le client d'une machine est construit dans `surNouvelleMachine`, de façon
 * SYNCHRONE et AVANT le rattachement de sa connexion : `ClientSuperviseurPc`
 * s'abonne au tuyau du lien dans son constructeur, et la première chose qui
 * circule au rattachement est justement la réconciliation.
 */

import { demarrerServeurApiWeb, type ServeurApiWeb } from '../../control-plane/api-web/index.ts';
import { ouvrirRegistre, type Mission, type OrigineApprobation, type Registre } from '../../control-plane/registre/index.ts';
import { ServiceNotifications } from '../../control-plane/notifications/index.ts';
import { deciderAutorisation, fenetreOuverte } from '../../control-plane/autonomie/index.ts';
import { creerServeurMcpControle } from '../../control-plane/orchestrateur/mcp-controle/index.ts';
import type { CompacteurContexte } from '../../control-plane/orchestrateur/mcp-controle/serveur.ts';
import type { McpServerConfig } from '@anthropic-ai/claude-agent-sdk';
import {
  demarrerOrchestrateur,
  JournalIncidentsFichier,
  type StockageIdentite,
} from '../../control-plane/orchestrateur/processus/index.ts';
import { reconcilier, type DependancesReconciliation } from '../../control-plane/reconciliation/index.ts';
import {
  GestionnaireConversations,
  type ConstruireSessionConversation,
} from '../../control-plane/orchestrateur/gestionnaire-conversations.ts';
import { randomUUID } from 'node:crypto';
import { dispatcherMandat, ErreurMandatDejaTranche } from '../../control-plane/orchestrateur/dispatch-mandat.ts';
import { ACCES_DEFAUT } from '../../shared/acces-mandat.ts';
import { PLAFOND_EQUIPE_USD } from '../../shared/budget-equipe.ts';
import { ServiceInspection } from '../../control-plane/inspection/index.ts';
import type { EnregistreurProposition } from '../../control-plane/orchestrateur/mcp-controle/types.ts';
import { compositionLogger } from '../logger.ts';
import { ClientSuperviseurPc } from './client-superviseur-pc.ts';
import { creerAgregatParc, ParcSuperviseurs } from './parc-superviseurs.ts';
import { creerDeclencheurReconciliationSurRattachement } from './reconciliation-sur-rattachement.ts';
import { demarrerServeurLienPc, type ServeurLienPc } from './serveur-lien-pc.ts';
import { creerLecteurUtilisationParc } from './port-utilisation-parc.ts';
import { creerVerificateurSessionSdk } from './verificateur-session-sdk.ts';
import { demarrerBalayageTelemetrie, type BalayageTelemetrie } from './balayage-telemetrie.ts';
import { demarrerBalayageQuotas, type BalayageQuotas } from './balayage-quotas.ts';
import { demarrerBalayageRappels, type BalayageRappels } from './balayage-rappels.ts';
import { demarrerBalayageCloture, type BalayageCloture } from './balayage-cloture.ts';
import { choisirCompteDisponible } from './choix-compte-orchestrateur.ts';

const log = compositionLogger.child({ composant: 'assembler-control-plane-pi' });

/**
 * Budget d'un mandat dont l'orchestrateur ne dit rien. Il PEUT désormais le fixer
 * lui-même (`creer_equipe.budgetMaxUsd`, 03/08) : ceci n'est plus que le filet.
 */
const BUDGET_MANDAT_DEFAUT_USD = PLAFOND_EQUIPE_USD;

/**
 * Combien de temps `creer_equipe` attend la confirmation d'un dispatch avant de
 * répondre « en vol ».
 *
 * `☠` Mesuré sur le chemin réel : résolution de machine, vérification du projet
 * sur place (un aller-retour sur le lien), puis spawn du worker. Quelques
 * secondes en régime normal ; l'échec de routage, lui, revient immédiatement.
 * Trop court, on annoncerait « en vol » des équipes déjà parties ; trop long, on
 * immobiliserait le tour de l'orchestrateur sur une machine muette.
 */
const PLAFOND_DISPATCH_MS = 20_000;

/** Issue réelle d'un dispatch auto, telle qu'elle remonte jusqu'au modèle. */
type IssueDispatch =
  | { readonly etat: 'parti'; readonly missionId: string; readonly detail: string }
  | { readonly etat: 'en_vol'; readonly detail: string }
  | { readonly etat: 'echec'; readonly detail: string };

export interface OptionsAssemblageControlPlanePi {
  readonly cheminRegistreDb: string;
  /**
   * `☠` L'identité SDW n'est plus un fichier unique : chaque conversation porte
   * son propre `session_id` en base (migration 2). Ce chemin n'est donc plus
   * requis pour l'orchestrateur multi-sessions.
   */
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
  /**
   * Comptes de repli du MASTER, sur le Pi. `☠` Distincts des comptes du registre,
   * qui vivent sur le PC et sont inutilisables ici : sans repli local, une
   * saturation rend l'orchestrateur définitivement muet (vécu le 23/07).
   */
  readonly configDirsOrchestrateur?: readonly string[];
  readonly seuilUtilisationPctPlafondParc?: number;
  /** Comptes Claude à garantir dans le registre au démarrage (idempotent). */
  readonly comptes?: readonly { readonly id: string; readonly configDir: string; readonly libelle?: string }[];
  /**
   * Démarre la session orchestrateur maître. `☠` Par défaut FAUX : cette
   * session consomme du quota en continu et exige des credentials Claude
   * valides sur le Pi. Le reste du control plane — parc, pilotage,
   * lien vers le PC — n'en dépend en RIEN : l'opérateur pilote ses missions
   * même sans elle. La coupler d'office rendrait tout le produit tributaire
   * d'un `/login` sur le Pi.
   */
  readonly avecOrchestrateur?: boolean;
}

export interface ControlPlanePiAssemble {
  readonly registre: Registre;
  /** Les machines de travail rattachées, et le routage vers chacune (V2). */
  readonly parcSuperviseurs: ParcSuperviseurs;
  readonly serveurLien: ServeurLienPc;
  readonly serveurApiWeb: ServeurApiWeb;
  /**
   * Gestionnaire des conversations orchestrateur (multi-sessions, type ChatGPT).
   * `null` quand `avecOrchestrateur` est faux. `☠` Possède ses propres boucles de
   * lecture (une par session) — `bin-pi.ts` n'a plus de lecteur global à tenir.
   */
  readonly gestionnaireConversations: GestionnaireConversations | null;
  readonly balayageTelemetrie: BalayageTelemetrie;
  readonly balayageQuotas: BalayageQuotas;
  readonly balayageRappels: BalayageRappels;
  readonly balayageCloture: BalayageCloture;
}

/**
 * `☠` `busPermissions` n'est PLUS fourni : le bus d'escalade a été retiré le
 * 2026-07-31 (aucune demande n'y est jamais arrivée — en `permissionMode: 'auto'`
 * le SDK n'appelle pas `canUseTool`). La réconciliation gère déjà ce cas : une
 * demande que le SDK dit en attente est tracée `permission_orpheline`, motif
 * `bus_permissions_non_cable`. Elle CONSTATE, elle ne prétend pas redélivrer.
 *
 * `☠ V2` — les dépendances sont construites PAR MACHINE, avec son propre client
 * et un périmètre borné à SES missions. Une réconciliation qui agrégerait
 * l'inventaire de toutes les machines conclurait « fantôme » pour chaque mission
 * vivant sur une machine hors ligne, et la terminerait — alors qu'une machine
 * éteinte est un état parfaitement nominal (H-75). Le périmètre est donc la
 * pièce qui rend la réconciliation multi-machines sûre, pas un détail.
 */
function construireDependancesReconciliation(
  client: ClientSuperviseurPc,
  machineId: string,
): DependancesReconciliation {
  return {
    inventairePc: client,
    reinitialisateur: client,
    concerne: (mission) => mission.machine === machineId,
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

  // `☠` Les comptes sont garantis ICI, dans la connexion du service lui-même,
  // idempotent à chaque démarrage. Un script d'enregistrement séparé écrivait
  // dans une autre connexion et se faisait effacer par une course WAL au
  // redémarrage (constaté en prod : comptes disparus après chaque déploiement).
  // Ici, aucune course : c'est la même connexion, à chaque boot.
  for (const compte of options.comptes ?? []) {
    if (registre.comptes.lire(compte.id) === null) {
      registre.comptes.enregistrer({ id: compte.id, configDir: compte.configDir, organisation: compte.libelle });
      log.info({ id: compte.id }, 'compte enregistré au démarrage (idempotent)');
    }
  }

  // `☠` Le déclencheur de réconciliation est câblé APRÈS le parc (il a besoin du
  // registre et des clients), mais `demarrerServeurLienPc` doit recevoir les
  // callbacks AVANT qu'une connexion n'arrive. Indirection par référence
  // mutable : seules les affectations sont différées de quelques lignes.
  let declencheurReconciliation: ((machineId: string) => void) | null = null;
  let parcSuperviseurs: ParcSuperviseurs | null = null;

  const serveurLien = demarrerServeurLienPc({
    port: options.portLienPc,
    hostname: options.hostnameLienPc,
    secret: options.secretLienPc,
    // `☠` Un client PAR MACHINE, construit à sa première connexion. Synchrone et
    // avant le rattachement : `ClientSuperviseurPc` s'abonne au tuyau dans son
    // constructeur, et ce qui circule en premier au rattachement est justement
    // la réconciliation.
    surNouvelleMachine: (machineId, lien) => parcSuperviseurs?.enregistrer(machineId, new ClientSuperviseurPc(lien)),
    surConnexionAcceptee: (machineId) => declencheurReconciliation?.(machineId),
  });

  const parc = new ParcSuperviseurs({
    registre,
    // `☠` Branché sur l'ÉTAT RÉEL du lien de cette machine, jamais sur un
    // drapeau tenu à la main : c'est ce qui fait que l'interface dit « machine
    // éteinte » parce qu'elle l'est, et non parce qu'un booléen a été oublié.
    enLigne: (machineId) => serveurLien.lienPour(machineId)?.etat() === 'ouvert',
  });
  parcSuperviseurs = parc;
  const agregatParc = creerAgregatParc(parc);

  /**
   * Ordres portés par une MISSION : ils partent vers la machine où l'équipe
   * tourne réellement (`mission.machine`).
   *
   * `☠` Machine hors ligne ⇒ `ErreurRoutageMachine` remontée telle quelle, avec
   * la liste des machines. Un ordre d'arrêt silencieusement perdu est pire que
   * pas d'ordre du tout : l'opérateur croit l'équipe coupée et elle continue de
   * dépenser.
   */
  const versMission = {
    arreter: async (missionId: string): Promise<void> => parc.pourMission(missionId).client.arreter(missionId),
    relancer: async (missionId: string, sessionId: string): Promise<{ readonly dejaVivant: boolean }> =>
      parc.pourMission(missionId).client.relancer(missionId, sessionId),
    envoyerInstruction: async (missionId: string, texte: string): Promise<{ readonly detail: string }> =>
      parc.pourMission(missionId).client.envoyerInstruction(missionId, texte),
    mettreEnPause: async (missionId: string): Promise<void> => parc.pourMission(missionId).client.mettreEnPause(missionId),
    reprendre: async (missionId: string): Promise<void> => parc.pourMission(missionId).client.reprendre(missionId),
    interrompre: async (missionId: string): Promise<void> => parc.pourMission(missionId).client.interrompre(missionId),
    inspecter: async (missionId: string): Promise<{ readonly verdict: string; readonly motif: string }> =>
      parc.pourMission(missionId).client.inspecter(missionId),
  };

  /**
   * La machine d'un fil donné. Hors fil (chemins de service, bancs), on retombe
   * sur la résolution sans ambiguïté du parc.
   *
   * `☠` LÈVE plutôt que de choisir au hasard quand deux machines sont en ligne
   * et qu'aucune n'est précisée : lire l'arborescence de la mauvaise machine
   * ferait cadrer un mandat sur des fichiers qui n'existent pas là où l'équipe
   * tournera — et l'erreur n'apparaîtrait qu'au démarrage du worker.
   */
  const machineDuFil = (conversationId: string | undefined): ClientSuperviseurPc =>
    conversationId === undefined
      ? parc.resoudre(null, 'opération hors conversation').client
      : parc.pourConversation(conversationId).client;

  /**
   * `☠` Le serveur de contrôle est construit PAR CONVERSATION : l'outil
   * `compacter_mon_contexte` doit savoir quelle session il compacte. Un serveur
   * partagé ne pourrait pas le dire — il compacterait au hasard.
   */
  const construireServeurControle = (
    compacteur?: CompacteurContexte,
    propositions?: EnregistreurProposition,
    conversationId?: string,
  ): McpServerConfig =>
    creerServeurMcpControle({
      registre,
      // `☠` Sans lui, `mon_autonomie` ne sait pas de quel fil il parle : un
      // serveur de contrôle est construit PAR conversation, et l'identité doit
      // suivre jusqu'ici — sinon l'orchestrateur lit l'autonomie d'un autre fil,
      // ou rien du tout.
      conversationId,
      repertoireProjets: options.repertoireProjets,
      // `☠` Le MÊME chemin que celui qui sert l'interface depuis le 01/08
      // (`pilotage` sur le canal de contrôle), et non plus un port fantôme :
      // `envoyer_a_equipe` refusait TOUTES les équipes, vivantes comprises.
      emetteur: {
        envoyer: (missionId, texte) => versMission.envoyerInstruction(missionId, texte),
        interrompre: (missionId) => versMission.interrompre(missionId),
      },
      arreteur: versMission,
      relanceur: versMission,
      // `☠` Le plafond vit au REGISTRE et devient effectif par le balayage de
      // télémétrie (`arreterSurPlafond`). Avant, ce port levait toujours : un
      // filet de dernier recours qui ne pouvait pas être posé.
      budget: {
        definir: async (missionId: string, maxUsd: number): Promise<void> => {
          registre.missions.definirBudgetMax(missionId, maxUsd);
        },
      },
      utilisationParc: creerLecteurUtilisationParc(registre),
      configPlafondParc: { seuilUtilisationPct: options.seuilUtilisationPctPlafondParc },
      compacteurContexte: compacteur,
      propositions,
      // `☠` Les projets sont ceux de LA MACHINE DU FIL, pas d'une machine par
      // défaut. Deux machines n'hébergent pas les mêmes dépôts (le VPS a
      // `stockiop`, le PC a tout le reste) : explorer la mauvaise ferait cadrer
      // un mandat sur une arborescence qui n'existe pas là où l'équipe tournera.
      explorateurProjets: { explorerProjets: (chemin) => machineDuFil(conversationId).explorerProjets(chemin) },
      lecteurFichier: { lireFichier: (chemin) => machineDuFil(conversationId).lireFichier(chemin) },
      // `☠` Câblé le jour même où l'outil existe. Le motif « écrit, testé,
      // branché sur rien » a coûté neuf fois à ce dépôt, dont deux fois sur ces
      // mêmes ports projets (23/07) — l'orchestrateur voyait l'arborescence sans
      // pouvoir en lire une ligne, puis lisait sans pouvoir chercher.
      chercheurProjets: {
        rechercherProjets: (motif, chemin, max) => machineDuFil(conversationId).rechercherProjets(motif, chemin, max),
      },
    });

  // `☠` La réconciliation est câblée AVANT le serveur API et le gestionnaire :
  // elle ne dépend que du parc (déjà construit), et elle doit être prête si une
  // connexion arrive.
  //
  // `☠ V2` — une passe PAR MACHINE, avec l'inventaire de cette machine et un
  // périmètre borné à ses missions. Agréger conclurait « fantôme » pour toute
  // mission vivant sur une machine hors ligne, et la terminerait.
  const reconciliationDe = (machineId: string): DependancesReconciliation | null => {
    const client = parc.pour(machineId);
    return client === null ? null : construireDependancesReconciliation(client, machineId);
  };
  declencheurReconciliation = creerDeclencheurReconciliationSurRattachement(registre, reconciliationDe);

  // `☠` Multi-sessions (type ChatGPT) : le gestionnaire construit une session par
  // conversation À LA DEMANDE. Aucune session au boot — le quota ne brûle que
  // quand l'opérateur écrit. La réconciliation du parc, elle, vit sur le
  // rattachement du PC (ci-dessus), indépendante de ces sessions.
  /**
   * Chemin UNIQUE du dispatch d'un mandat autorisé — que l'autorisation vienne
   * d'un clic ou de l'autonomie du fil.
   *
   * `☠` Un seul chemin, délibérément. Deux implémentations (une pour le bouton,
   * une pour l'auto) divergeraient au premier correctif appliqué d'un seul côté,
   * et le côté oublié serait l'automatique — celui que personne ne regarde
   * tourner. `origine` ne change QUE ce qu'on écrit au registre, jamais ce qui
   * est fait.
   *
   * Déclarée en `function` : hoistée, donc utilisable par la closure
   * d'enregistrement définie plus haut dans ce même corps.
   */
  async function dispatcherMandatAutorise(
    id: string,
    origine: OrigineApprobation,
  ): Promise<{ readonly missionId: string; readonly detail: string }> {
    const p = registre.propositions.lire(id);
    if (p === null) throw new Error('mandat inconnu');
    if (p.statut !== 'en_attente') throw new ErreurMandatDejaTranche(p.statut, p.missionId);
    // `☠` LA machine du fil qui a proposé ce mandat. Résolue AVANT toute
    // écriture : si elle est hors ligne ou ambiguë, le mandat est refusé en
    // clair plutôt que de partir sur une machine choisie au hasard. Le
    // `demarreur` et la colonne `machine` viennent de la MÊME résolution — les
    // dissocier produirait une équipe qu'aucun arrêt ne pourrait atteindre.
    const cible =
      p.conversationId === null
        ? parc.resoudre(null, `mandat ${id}`)
        : parc.pourConversation(p.conversationId);
    const r = await dispatcherMandat(p, {
      registre,
      demarreur: cible.client,
      machine: cible.machineId,
      // Confinement inchangé : `explorerProjets` compare des chemins résolus, on
      // ne fait ici que demander « ce chemin existe-t-il, là-bas ? ».
      //
      // `☠` Le critère n'est PAS « aucune note » — lu dans
      // `superviseur/exploration-projets.ts`, une note est aussi posée sur une
      // TRONCATURE (« 300 entrées, 200 rendues ». Un gros dépôt aurait donc été
      // déclaré absent. Le critère mesuré est : répertoire vide ET note posée.
      // Une troncature implique toujours au moins une entrée.
      verifierProjet: async (chemin: string) => {
        const exploration = await cible.client.explorerProjets(chemin);
        const note = exploration.note ?? '';
        return { present: exploration.entrees.length > 0 || note === '', note };
      },
      repertoireProjets: options.repertoireProjets,
    });
    // `☠` Tranché APRÈS le démarrage réussi : marquer « approuvée » avant
    // laisserait un mandat consommé sans équipe si le PC refusait.
    registre.propositions.trancher(id, 'approuvee', r.detail, r.missionId, Date.now(), origine);
    return r;
  }

  /**
   * Relève l'état du dépôt d'une mission sur SA machine et le persiste.
   *
   * `☠` Best-effort et jamais bloquant pour la notification : machine hors
   * ligne, dépôt absent, `git` muet — on renonce en le journalisant, et la
   * mission garde `constatGit: null`, qui se lit « jamais mesuré ». Le seul
   * résultat interdit ici serait d'écrire « propre » sans avoir mesuré.
   */
  async function releverConstatGit(missionId: string): Promise<Mission | null> {
    const mission = registre.missions.lire(missionId);
    if (mission === null || mission.worktree === null) return null;
    try {
      const constat = await parc.pourMission(missionId).client.etatGit(mission.worktree);
      if (!constat.depot) return null;
      return registre.missions.poserConstatGit(missionId, {
        fichiersModifies: constat.fichiersModifies,
        branche: constat.branche,
        dernierCommit: constat.dernierCommit,
      });
    } catch (erreur) {
      log.warn({ err: erreur, missionId }, 'état git non relevé — la mission reste sans constat (jamais « propre » par défaut)');
      return null;
    }
  }

  /**
   * Lance le dispatch d'un mandat auto-approuvé et rend son issue RÉELLE, sans
   * jamais immobiliser le tour de l'orchestrateur au-delà du plafond.
   *
   * `☠` La promesse n'est PAS annulée au dépassement : un dispatch en vol doit
   * aboutir (l'équipe démarre vraiment), et son échec éventuel reste journalisé.
   * Ce qui est borné, c'est l'ATTENTE — jamais le travail.
   */
  async function issueDuDispatch(
    propositionId: string,
    raisonAutorisation: string,
  ): Promise<{ ref: string; autoApprouve: true; detail: string; dispatch: IssueDispatch }> {
    const enCours = dispatcherMandatAutorise(propositionId, 'auto').catch((erreur: unknown) => {
      log.error({ err: erreur, propositionId }, 'dispatch auto en échec');
      return erreur instanceof Error ? erreur : new Error(String(erreur));
    });
    const echeance = new Promise<'delai'>((resoudre) => {
      const t = setTimeout(() => resoudre('delai'), PLAFOND_DISPATCH_MS);
      if (typeof t.unref === 'function') t.unref();
    });
    const issue = await Promise.race([enCours, echeance]);
    const base = { ref: propositionId, autoApprouve: true as const, detail: raisonAutorisation };
    if (issue === 'delai') {
      return { ...base, dispatch: { etat: 'en_vol', detail: `pas de confirmation en ${PLAFOND_DISPATCH_MS / 1000} s` } };
    }
    if (issue instanceof Error) return { ...base, dispatch: { etat: 'echec', detail: issue.message } };
    return { ...base, dispatch: { etat: 'parti', missionId: issue.missionId, detail: issue.detail } };
  }

  let gestionnaireConversations: GestionnaireConversations | null = null;
  // Même référence différée que `gestionnaire` ci-dessous, dans l'autre sens :
  // les deux se connaissent, aucun ne peut être construit en premier.
  let serviceNotifications: ServiceNotifications | null = null;
  if (options.avecOrchestrateur === true) {
    // Référence différée : le gestionnaire n'existe pas encore quand on décrit
    // comment construire ses sessions — mais il existera à l'appel.
    let gestionnaire: GestionnaireConversations | null = null;
    const comptesMaster = [
      ...(options.configDirOrchestrateur !== undefined ? [options.configDirOrchestrateur] : []),
      ...(options.configDirsOrchestrateur ?? []),
    ].filter((d, i, tout) => tout.indexOf(d) === i);
    // `☠` Sur QUOTA MESURÉ, jamais « toujours le premier » : l'index vivait en
    // mémoire et repartait à 0 à chaque redémarrage du Pi, renvoyant
    // l'orchestrateur sur un compte à 100 % — l'opérateur devait écrire deux
    // fois, à chaque déploiement (vécu le 23/07).
    let indexMaster = choisirCompteDisponible(comptesMaster, registre);
    const construireSession: ConstruireSessionConversation = (
      stockageIdentite: StockageIdentite,
      conversationId: string,
      forcerReprise?: boolean,
    ) =>
      demarrerOrchestrateur({
        stockageIdentite,
        // `☠` Le vérificateur a besoin du CONFIG DIR : les transcripts vivent
        // sous le dossier du compte orchestrateur, pas sous `~/.claude`. L'oubli
        // faisait repartir toute reprise à froid sur un id déjà pris (prod, 23/07).
        verificateurSessionExistante:
          forcerReprise === true
            ? { existe: async (): Promise<boolean> => true }
            : creerVerificateurSessionSdk(options.cwdOrchestrateur, options.configDirOrchestrateur),
        serveurControle: construireServeurControle(
          {
            demander: () =>
              gestionnaire?.demanderCompaction(conversationId) ?? { arme: false, detail: 'gestionnaire indisponible' },
          },
          {
            // `☠` La proposition est persistée ET un marqueur est posé dans le
            // fil : c'est ce marqueur qui fait apparaître la carte à autoriser au
            // bon endroit, au lieu d'une liste hors contexte.
            enregistrer: async (mandat) => {
              const p = registre.propositions.creer({
                id: randomUUID(),
                conversationId,
                projet: mandat.projet,
                objectif: mandat.objectif,
                critereArret: mandat.critereArret,
                perimetre: mandat.perimetre,
                // `☠` Absent ⇒ `lecture`, jamais l'écriture : un chemin qui
                // oublierait de transmettre l'accès doit RETIRER des droits.
                acces: mandat.acces ?? ACCES_DEFAUT,
                // `☠` Le plafond demandé au dépôt prime, et c'est le seul instant
                // où il peut encore protéger quoi que ce soit : `definir_budget`
                // n'existe qu'après démarrage, et une mission d'une minute
                // (`96a9c788`, 03/08) finit avant le premier réveil de
                // l'orchestrateur. Absent ⇒ le filet du parc, jamais l'illimité.
                budgetMaxUsd: mandat.budgetMaxUsd ?? BUDGET_MANDAT_DEFAUT_USD,
                modele: mandat.modele ?? null,
                effort: mandat.effort ?? null,
              });
              registre.conversations.ajouterEvenement({ conversationId, type: 'mandat', contenu: p.id });

              // `☠` La décision d'autonomie se prend ICI, au dépôt, et pas plus
              // tard : c'est le seul point qui connaît à la fois la conversation
              // et le registre. Prise en aval, elle aurait laissé une carte
              // « à autoriser » s'afficher pour un mandat déjà parti.
              const conv = registre.conversations.lire(conversationId);
              const decision = deciderAutorisation({
                approbationHumaineAnterieure: registre.propositions.aApprobationHumaine(conversationId),
                autoApprouveesDeja: registre.propositions.compterAutoApprouvees(
                  conversationId,
                  conv?.autonomieDebut ?? 0,
                ),
                fenetreDebut: conv?.autonomieDebut ?? null,
                fenetreFin: conv?.autonomieFin ?? null,
                maintenant: Date.now(),
              });
              if (decision.mode === 'humain') {
                return { ref: p.id, autoApprouve: false, detail: decision.raison };
              }

              // `☠` ATTENDU, mais BORNÉ (02/08). Ce dispatch partait en `void` :
              // `creer_equipe` répondait « équipe lancée » avant que rien ne
              // démarre, et deux échecs de routage machine ce matin-là n'ont
              // jamais atteint le modèle — il a construit tout son tour sur une
              // équipe qui n'existait pas. On attend donc la confirmation, sans
              // jamais immobiliser le tour : au-delà du plafond, le dispatch
              // CONTINUE en arrière-plan et la réponse dit « en vol », ce qui
              // est la vérité — ni un succès, ni un échec.
              return await issueDuDispatch(p.id, decision.raison);
            },
          },
          conversationId,
        ),
        registre,
        // `☠` Évalué À CHAQUE démarrage de session, jamais capturé : une machine
        // apparue depuis l'assemblage doit être couverte.
        reconciliation: () =>
          parc
            .clientsEnLigne()
            .map(({ machineId }) => reconciliationDe(machineId))
            .filter((d): d is DependancesReconciliation => d !== null),
        incidents: new JournalIncidentsFichier(options.cheminIncidentsOrchestrateur),
        cwd: options.cwdOrchestrateur,
        configDir: comptesMaster[indexMaster] ?? options.configDirOrchestrateur,
      });
    gestionnaireConversations = new GestionnaireConversations(registre, construireSession, () => {
      // On saute les comptes que le registre sait déjà saturés : basculer sur un
      // compte mort ne fait que déplacer le mur d'un message.
      const suivant = choisirCompteDisponible(comptesMaster, registre, indexMaster + 1);
      if (suivant >= comptesMaster.length || suivant === indexMaster) return false;
      indexMaster = suivant;
      log.warn({ configDir: comptesMaster[indexMaster] }, 'rotation du compte de l’orchestrateur');
      return true;
    },
    async (conversationId) => {
      await serviceNotifications?.remettreEnAttente(conversationId);
    });
    gestionnaire = gestionnaireConversations;
  } else {
    log.warn(
      {},
      'control plane assemblé SANS orchestrateur (avecOrchestrateur absent) — parc et pilotage opérationnels ; conversations désactivées (501)',
    );
  }

  // `☠` `pcEnLigne` est branché sur l'ÉTAT RÉEL du lien, jamais sur un drapeau
  // tenu à la main : c'est ce qui fait que l'interface dit « PC éteint » parce
  // qu'il l'est, et non parce qu'un booléen a été oublié quelque part.
  const serveurApiWeb = demarrerServeurApiWeb({
    port: options.portApiWeb,
    registre,
    // `☠` « Au moins une machine de travail joignable » — la sémantique a changé
    // avec la V2, pas le contrat H-75 : l'absence reste un état, jamais une
    // erreur HTTP. `machines` porte le détail par machine, `pcOnline` reste le
    // drapeau global dont dépend tout l'affichage existant.
    pcEnLigne: () => parc.auMoinsUneEnLigne(),
    machines: () =>
      serveurLien.machines().map((m) => ({ id: m.machineId, enLigne: m.enLigne, supersedes: m.supersedes })),
    // `☠` Interrogées EN PARALLÈLE et jamais en série : deux allers-retours dont
    // l'un traverse Cloudflare additionneraient leurs latences, et la page
    // rafraîchirait au rythme de la machine la plus lente. Une machine hors
    // ligne n'est pas interrogée du tout — elle apparaît avec `metriques: null`.
    metriquesMachines: async () =>
      Promise.all(
        serveurLien.machines().map(async (m) => ({
          id: m.machineId,
          enLigne: m.enLigne,
          metriques: m.enLigne ? ((await parc.pour(m.machineId)?.metriquesHote()) ?? null) : null,
        })),
      ),
    // `☠` Les ordres partent par le MÊME lien que le reste (H-75, un seul
    // lien). `arretUrgence` n'est pas exposé par `ClientSuperviseurPc` : le
    // chemin G.4 passe par le canal de contrôle et n'a pas encore de méthode
    // ici — l'omettre fait répondre 501, jamais un faux succès.
    pc: {
      arreter: (missionId) => versMission.arreter(missionId),
      envoyerInstruction: (missionId, texte) => versMission.envoyerInstruction(missionId, texte),
      mettreEnPause: (missionId) => versMission.mettreEnPause(missionId),
      reprendre: (missionId) => versMission.reprendre(missionId),
    },
    // Inspection à la demande (H-68) : le juge vit sur le PC, le verdict et sa
    // décision vivent au registre. `☠` Le même `clientSuperviseurPc` sert à
    // interroger ET à arrêter — un verdict confirmé doit couper par le chemin
    // d'arrêt éprouvé, jamais par une seconde implémentation.
    inspection: new ServiceInspection(registre, versMission, {
      arreter: (missionId) => versMission.arreter(missionId),
    }),
    conversations: gestionnaireConversations ?? undefined,
    mandats: {
      enAttente: () => registre.propositions.enAttente(),
      refuser: (id) => registre.propositions.trancher(id, 'refusee', "refusé par l'opérateur", null),
      // Le clic de Chris — même chemin que l'autonomie, seule l'origine change.
      approuver: (id) => dispatcherMandatAutorise(id, 'humain'),
    },
  });

  // `☠` Sans ce balayage, l'interface affiche « (non résolu) », un coût à 0 et un
  // contexte à 0 sur des équipes qui travaillent : le PC observe tout, mais rien
  // ne remontait jusqu'au registre du Pi.
  // `☠` La réconciliation est câblée ICI, et pas seulement au démarrage/rattachement :
  // un worker qui meurt alors que tout est connecté n'était vu par PERSONNE, et sa
  // mission restait `en_cours` à jamais (23/07).
  // `☠` Le canal asynchrone (migration 14) : c'est ici, et seulement ici, que
  // le domaine des notifications rencontre le gestionnaire de conversations.
  // L'inversion de dépendance existe pour ça — `notifications/` ne sait rien de
  // l'orchestrateur, la composition les marie.
  //
  // `☠` `estActive` interdit un réveil implicite : sans orchestrateur assemblé,
  // le service journalise et se tait, au lieu de faire échouer un balayage.
  const conversationsPourNotifications = gestionnaireConversations;
  const notifications = new ServiceNotifications(
    registre,
    conversationsPourNotifications === null
      ? undefined
      : {
          estActive: (id) => conversationsPourNotifications.estActive(id),
          remettre: (id, texte) => conversationsPourNotifications.remettreNotification(id, texte),
        },
  );
  // Referme la référence différée : le gestionnaire, construit plus haut, peut
  // désormais déclencher le rattrapage.
  serviceNotifications = notifications;

  const balayageTelemetrie = demarrerBalayageTelemetrie({
    registre,
    // `☠` Agrégée sur les machines EN LIGNE. Une machine éteinte n'apporte rien
    // et ne doit pas faire échouer le relevé des autres (H-75).
    source: agregatParc,
    // `☠` Une passe PAR MACHINE, chacune bornée à SES missions. Une passe
    // globale sur l'inventaire d'une seule machine terminerait en « fantômes »
    // toutes les équipes des autres.
    reconcilier: async () => {
      for (const { machineId } of parc.clientsEnLigne()) {
        const deps = reconciliationDe(machineId);
        if (deps !== null) await reconcilier(registre, deps, 'reconnexion');
      }
    },
    signalerFinEquipe: async (missionId) => {
      const missionAvant = registre.missions.lire(missionId);
      if (missionAvant === null) return;
      // `☠` RELEVÉ AVANT LA NOTIFICATION, jamais après : c'est le seul fait qui
      // distingue une équipe qui a LIVRÉ d'une équipe qui a seulement fini de
      // parler. Sans lui, le harness invitait à arrêter une équipe dont sept
      // fichiers n'étaient pas commités (02/08). Un relevé impossible (machine
      // hors ligne, dépôt illisible) laisse `constatGit` à `null` — « jamais
      // mesuré », ce que la rédaction dit explicitement plutôt que de conclure.
      const mission = await releverConstatGit(missionAvant.id) ?? missionAvant;
      // `☠` LE câblage qui manquait. `reveiller` existait, était testé, et
      // n'était passé par PERSONNE — le motif « écrit, testé, branché sur rien »,
      // commis le jour même où on le documentait. Conséquence réelle : pendant
      // une fenêtre d'autonomie, session endormie, une fin d'équipe ne réveillait
      // pas l'orchestrateur. La plage déléguée s'arrêtait donc à la première
      // équipe, sans erreur, sans trace — exactement le silence qu'on cherche à
      // supprimer depuis ce matin.
      const conv =
        mission.conversationId === null ? null : registre.conversations.lire(mission.conversationId);
      const reveiller =
        conv !== null &&
        fenetreOuverte({
          approbationHumaineAnterieure: false,
          autoApprouveesDeja: 0,
          fenetreDebut: conv.autonomieDebut,
          fenetreFin: conv.autonomieFin,
          maintenant: Date.now(),
        });
      await notifications.signaler('equipe_terminee', mission, { reveiller });
    },
    /**
     * `☠` LE plafond de dépense devient RÉEL ici. Jusqu'au 02/08, `budgetMaxUsd`
     * n'était comparé à rien côté Pi : seul le SDK bornait, avec la valeur figée
     * au démarrage de la session. Une baisse décidée en cours de route
     * (`definir_budget`) n'avait donc aucun effet. L'ordre part vers la machine
     * qui héberge l'équipe, et l'état harness est écrit AVANT — un ordre perdu
     * ne doit pas laisser une équipe hors budget passer pour bornée.
     */
    arreterSurPlafond: async (missionId, motif) => {
      registre.etats.appliquerEtatHarness(missionId, 'annulee', { motif });
      const mission = registre.missions.lire(missionId);
      if (mission !== null) {
        await notifications.signaler('equipe_echouee', mission, { raison: motif });
      }
      await versMission.arreter(missionId);
    },
  });

  // `☠` Boucle SÉPARÉE de la télémétrie : elle interroge l'API d'usage en HTTP,
  // sans le PC et sans lancer la moindre session. C'est ce qui fait tenir des
  // jauges vivantes PC ÉTEINT, là où la sonde SDK côté PC les figeait dès
  // l'extinction — et avec 10 min de retard même PC allumé (23/07).
  const balayageQuotas = demarrerBalayageQuotas({ registre, source: agregatParc });
  void balayageQuotas.passer();

  // `☠` Troisième boucle, indépendante des deux autres : un rappel doit tirer
  // PC éteint et sans qu'aucune session ne tourne — c'est précisément son objet.
  // Elle réveille donc le fil, contrairement aux notifications de fin d'équipe
  // qui, elles, attendent une raison. Ici la raison est l'échéance elle-même.
  const balayageRappels = demarrerBalayageRappels({
    registre,
    reveil: {
      remettre: async (id, texte) => {
        if (conversationsPourNotifications === null) {
          throw new Error('orchestrateur non assemblé — aucun fil à réveiller');
        }
        await conversationsPourNotifications.remettreNotification(id, texte);
      },
    },
  });

  // `☠` Quatrième boucle, et elle existe parce que RIEN ne clôturait une équipe
  // au repos : `idle` ne change pas l'état harness, `en_cours` occupe le projet
  // (H-56), donc un lead ayant parfaitement travaillé verrouillait son projet
  // jusqu'à un clic humain. Mesuré le 01/08 sur `/mnt/projects/echohub` : équipe
  // idle depuis 16 min, parc vide à l'écran, dispatch suivant refusé.
  const balayageCloture = demarrerBalayageCloture({ registre, arreteur: versMission });

  log.info(
    { avecOrchestrateur: options.avecOrchestrateur === true, machines: parc.machinesConnues() },
    'control plane Pi assemblé (V2 — plusieurs machines de travail)',
  );

  return {
    registre,
    parcSuperviseurs: parc,
    serveurLien,
    serveurApiWeb,
    gestionnaireConversations,
    balayageTelemetrie,
    balayageQuotas,
    balayageRappels,
    balayageCloture,
  };
}
