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
 * `☠ H-75` — le Pi HÉBERGE désormais le lien (`serveur-lien-pc.ts`), le PC
 * INITIE (`composition/pc/client-lien-pi.ts`). Une seule instance de
 * `LienWebSocket` (`serveurLien.lien`) — jamais deux liens, conformément au
 * mandat (« un seul lien, décidé par l'opérateur »). La réconciliation
 * `'reconnexion'` (epoch incrémenté à chaque rattachement, D.2.3) est câblée
 * sur CHAQUE connexion PC acceptée, pas seulement au démarrage du Pi — voir
 * `reconciliation-sur-rattachement.ts`.
 */

import { demarrerServeurApiWeb, type ServeurApiWeb } from '../../control-plane/api-web/index.ts';
import { ouvrirRegistre, type OrigineApprobation, type Registre } from '../../control-plane/registre/index.ts';
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
import type { EnregistreurProposition } from '../../control-plane/orchestrateur/mcp-controle/types.ts';
import { compositionLogger } from '../logger.ts';
import { ClientSuperviseurPc } from './client-superviseur-pc.ts';
import { creerDeclencheurReconciliationSurRattachement } from './reconciliation-sur-rattachement.ts';
import { demarrerServeurLienPc, type ServeurLienPc } from './serveur-lien-pc.ts';
import { creerLecteurUtilisationParc } from './port-utilisation-parc.ts';
import { BUDGET_NON_CABLE, CIBLES_NON_CABLEES } from './ports-non-cables.ts';
import { creerVerificateurSessionSdk } from './verificateur-session-sdk.ts';
import { demarrerBalayageTelemetrie, type BalayageTelemetrie } from './balayage-telemetrie.ts';
import { demarrerBalayageQuotas, type BalayageQuotas } from './balayage-quotas.ts';
import { demarrerBalayageRappels, type BalayageRappels } from './balayage-rappels.ts';
import { demarrerBalayageCloture, type BalayageCloture } from './balayage-cloture.ts';
import { choisirCompteDisponible } from './choix-compte-orchestrateur.ts';

const log = compositionLogger.child({ composant: 'assembler-control-plane-pi' });

/** Budget par défaut d'un mandat proposé — l'orchestrateur n'en fixe pas encore. */
const BUDGET_MANDAT_DEFAUT_USD = PLAFOND_EQUIPE_USD;

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
  readonly clientSuperviseurPc: ClientSuperviseurPc;
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
 */
function construireDependancesReconciliation(client: ClientSuperviseurPc): DependancesReconciliation {
  return { inventairePc: client, reinitialisateur: client };
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
      cibles: CIBLES_NON_CABLEES,
      arreteur: clientSuperviseurPc,
      relanceur: clientSuperviseurPc,
      budget: BUDGET_NON_CABLE,
      utilisationParc: creerLecteurUtilisationParc(registre),
      configPlafondParc: { seuilUtilisationPct: options.seuilUtilisationPctPlafondParc },
      compacteurContexte: compacteur,
      propositions,
      explorateurProjets: { explorerProjets: (chemin) => clientSuperviseurPc.explorerProjets(chemin) },
      lecteurFichier: { lireFichier: (chemin) => clientSuperviseurPc.lireFichier(chemin) },
      // `☠` Câblé le jour même où l'outil existe. Le motif « écrit, testé,
      // branché sur rien » a coûté neuf fois à ce dépôt, dont deux fois sur ces
      // mêmes ports projets (23/07) — l'orchestrateur voyait l'arborescence sans
      // pouvoir en lire une ligne, puis lisait sans pouvoir chercher.
      chercheurProjets: {
        rechercherProjets: (motif, chemin, max) => clientSuperviseurPc.rechercherProjets(motif, chemin, max),
      },
    });

  // `☠` La réconciliation est câblée AVANT le serveur API et le gestionnaire :
  // elle ne dépend que du client PC (déjà construit), et elle doit être prête si
  // une connexion PC arrive.
  const dependancesReconciliation = construireDependancesReconciliation(clientSuperviseurPc);
  declencheurReconciliation = creerDeclencheurReconciliationSurRattachement(registre, dependancesReconciliation);

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
    const r = await dispatcherMandat(p, {
      registre,
      demarreur: clientSuperviseurPc,
      repertoireProjets: options.repertoireProjets,
    });
    // `☠` Tranché APRÈS le démarrage réussi : marquer « approuvée » avant
    // laisserait un mandat consommé sans équipe si le PC refusait.
    registre.propositions.trancher(id, 'approuvee', r.detail, r.missionId, Date.now(), origine);
    return r;
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
            enregistrer: (mandat) => {
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
                budgetMaxUsd: BUDGET_MANDAT_DEFAUT_USD,
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

              // `☠` Lancé sans être attendu : `enregistrer` doit rendre la main
              // au tour de l'orchestrateur en millisecondes, et un dispatch
              // ouvre une session sur le PC. L'échec ne se perd pas pour autant
              // — il retombe dans le fil comme une notification.
              void dispatcherMandatAutorise(p.id, 'auto').catch((erreur: unknown) => {
                log.error({ err: erreur, propositionId: p.id }, 'dispatch auto en échec');
              });
              return { ref: p.id, autoApprouve: true, detail: decision.raison };
            },
          },
          conversationId,
        ),
        registre,
        reconciliation: dependancesReconciliation,
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
    source: clientSuperviseurPc,
    reconcilier: () => reconcilier(registre, dependancesReconciliation, 'reconnexion'),
    signalerFinEquipe: async (missionId) => {
      const mission = registre.missions.lire(missionId);
      if (mission === null) return;
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
  });

  // `☠` Boucle SÉPARÉE de la télémétrie : elle interroge l'API d'usage en HTTP,
  // sans le PC et sans lancer la moindre session. C'est ce qui fait tenir des
  // jauges vivantes PC ÉTEINT, là où la sonde SDK côté PC les figeait dès
  // l'extinction — et avec 10 min de retard même PC allumé (23/07).
  const balayageQuotas = demarrerBalayageQuotas({ registre, source: clientSuperviseurPc });
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
  const balayageCloture = demarrerBalayageCloture({ registre, arreteur: clientSuperviseurPc });

  log.info({ avecOrchestrateur: options.avecOrchestrateur === true }, 'control plane Pi assemblé');

  return {
    registre,
    clientSuperviseurPc,
    serveurLien,
    serveurApiWeb,
    gestionnaireConversations,
    balayageTelemetrie,
    balayageQuotas,
    balayageRappels,
    balayageCloture,
  };
}
