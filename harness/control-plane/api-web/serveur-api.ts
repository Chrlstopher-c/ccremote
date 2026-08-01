/**
 * Responsabilité : le point d'entrée HTTP du control plane — ce que
 * `pi-web/app.py` relaie sous `/api/harness/...` (contrat :
 * `pi-web/CONTRAT-API-HARNESS.md`).
 *
 * `☠ JAMAIS EXPOSÉ DIRECTEMENT` — ce serveur écoute par défaut sur
 * `127.0.0.1` et n'a AUCUNE authentification propre. C'est délibéré : il est
 * précédé de `pi-web`, qui porte déjà la session et le mot de passe. Dupliquer
 * l'authentification ici créerait deux vérités sur « qui a le droit », et la
 * plus permissive gagnerait toujours en silence. En contrepartie, l'écoute sur
 * une interface publique est un défaut de configuration grave : d'où le refus
 * explicite de démarrer sur `0.0.0.0` plus bas, plutôt qu'un avertissement
 * qu'on ne lirait pas.
 *
 * `☠` Ce serveur ne PROPOSE que la lecture pour l'instant. Les écritures
 * (instruction, pause, arrêt d'urgence) traversent le lien vers le PC et
 * portent des conséquences réelles ; elles arriveront quand le chemin d'écriture
 * aura son propre banc d'assemblage. Une route d'écriture à moitié câblée est
 * pire qu'absente : l'interface croirait l'ordre passé.
 */

import type { Server } from 'bun';
import type { Registre } from '../registre/index.ts';
import { enveloppe, ErreurApi, introuvable, requeteInvalide } from './enveloppe.ts';
import { versSubagentDetailApi, versMissionApi } from './vue-missions.ts';
import {
  ErreurMandatDejaTranche,
  ErreurProjetAbsentDeLaMachine,
  ErreurProjetOccupe,
} from '../orchestrateur/dispatch-mandat.ts';
import { ErreurRoutageMachine } from '../../shared/routage-machine.ts';
import type { ServiceInspection } from '../inspection/service-inspection.ts';
import { construireFeed } from './vue-feed.ts';
import { versAccountApi } from './vue-comptes.ts';
import { versNotificationApi } from './vue-notifications.ts';
import { versRappelApi } from './vue-rappels.ts';
import { MODELES } from '../../shared/modeles-claude.ts';
import { traiterEcriture, type OrdresVersPc, type OrchestrateurConversation } from './ecritures.ts';
import {
  versEvenementApi,
  versConversationApi,
  type PortConversations,
  type PortMandats,
} from './vue-conversations.ts';
import { apiWebLogger } from './logger.ts';

const log = apiWebLogger;

/** Plafond de relances par défaut, affiché dans `retries` (« 1 / 3 »). */
const PLAFOND_RELANCES_DEFAUT = 3;

export interface DependancesApiWeb {
  readonly registre: Registre;
  /** Le lien réel vers les machines de travail — source unique de `pcOnline` (H-75). */
  readonly pcEnLigne: () => boolean;
  /**
   * Les machines de travail connues du Pi, en ligne ou non (migration 22).
   *
   * `☠` Absent ⇒ liste vide, jamais une machine fabriquée : c'est le cas des
   * déploiements et des bancs mono-machine, où l'interface doit simplement ne
   * proposer aucun choix plutôt qu'un choix inventé.
   */
  readonly machines?: () => readonly MachineApi[];
  /**
   * Ordres vers le PC. Absent ⇒ les routes d'écriture répondent 501 plutôt que
   * d'accepter un ordre qui ne partirait nulle part.
   */
  readonly pc?: OrdresVersPc;
  /** Inspection à la demande (H-68). Absent ⇒ les routes `/inspect` répondent 501. */
  readonly inspection?: ServiceInspection;
  /** Conversation avec la session orchestrateur maître (opt-in). */
  readonly orchestrateur?: OrchestrateurConversation;
  /**
   * Fils de discussion multi-sessions (type ChatGPT). Absent ⇒ orchestrateur
   * désactivé sur ce déploiement : les routes `/orchestrator/conversations*`
   * répondent 501, jamais une conversation fabriquée.
   */
  readonly conversations?: PortConversations;
  /**
   * Autorisation des mandats (H-61). Absent ⇒ les routes répondent 501 : mieux
   * vaut un bouton absent qu'un bouton qui n'autorise rien.
   */
  readonly mandats?: PortMandats;
  /** Contexte réel de l'orchestrateur (ratio 0-1), lu de la sentinelle. Absent = orchestrateur inactif. */
  readonly orchestrateurContexteRatio?: () => number | null;
  readonly maintenant?: () => number;
  readonly plafondRelances?: number;
}

/** Une machine de travail, telle que l'interface la voit. */
export interface MachineApi {
  readonly id: string;
  readonly enLigne: boolean;
  /** Évictions observées sur CETTE machine — doit rester à 0 (voir `serveur-lien-pc.ts`). */
  readonly supersedes: number;
}

export interface OptionsServeurApiWeb extends DependancesApiWeb {
  readonly port: number;
  /** `127.0.0.1` par défaut. Toute autre valeur d'écoute publique est REFUSÉE. */
  readonly hostname?: string;
}

export interface ServeurApiWeb {
  readonly port: number;
  arreter(): void;
}

const HOTES_PUBLICS = new Set(['0.0.0.0', '::', '*']);

function json(corps: unknown, statut = 200): Response {
  return new Response(JSON.stringify(corps), {
    status: statut,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

/** Sous-routage lecture des conversations. `null` = pas une route conversation. */
function routerLectureConversation(chemin: string, url: URL, deps: DependancesApiWeb, pcOnline: boolean): unknown {
  if (deps.conversations === undefined) return null;
  const conv = deps.conversations;

  if (chemin === '/orchestrator/conversations') {
    return enveloppe(pcOnline, conv.listerConversations().map(versConversationApi));
  }

  const evts = chemin.match(/^\/orchestrator\/conversations\/([^/]+)\/events$/);
  if (evts?.[1] !== undefined) {
    const depuis = Number.parseInt(url.searchParams.get('since') ?? '0', 10);
    const resume = conv.evenementsDepuis(decodeURIComponent(evts[1]), Number.isFinite(depuis) ? depuis : 0);
    if (resume === null) throw introuvable('conversation');
    return enveloppe(pcOnline, {
      events: resume.evenements.map(versEvenementApi),
      cursor: resume.curseur,
      generating: resume.genere,
      active: resume.active,
      contextPct: resume.contextePct,
      compactions: resume.compactions,
      // `☠` Le bloc en cours de frappe — c'est LUI qui fait le streaming visible.
      partial: resume.partiel,
    });
  }

  const detail = chemin.match(/^\/orchestrator\/conversations\/([^/]+)$/);
  if (detail?.[1] !== undefined) {
    const d = conv.detail(decodeURIComponent(detail[1]));
    if (d === null) throw introuvable('conversation');
    return enveloppe(pcOnline, {
      id: d.id,
      titre: d.titre,
      events: d.evenements.map(versEvenementApi),
      cursor: d.curseur,
      generating: d.genere,
      active: d.active,
      contextPct: d.contextePct,
      compactions: d.compactions,
      // `☠` Sans ces deux champs, l'interface n'a rien pour rouvrir le fil sur
      // son propre réglage : elle retombait sur Opus 4.8 / high à chaque
      // rafraîchissement (constaté en prod le 23/07, après un premier correctif
      // incomplet — le chemin de DONNÉES manquait, pas seulement l'affichage).
      model: d.modele,
      effort: d.effort,
      partial: d.partiel,
    });
  }

  return null;
}

/** Routage en lecture. Chaque branche reste courte : la vue fait la traduction. */
function router(chemin: string, url: URL, deps: DependancesApiWeb): unknown {
  const maintenant = deps.maintenant?.() ?? Date.now();
  const pcOnline = deps.pcEnLigne();
  const plafond = deps.plafondRelances ?? PLAFOND_RELANCES_DEFAUT;

  // `☠` AVANT `routerLectureConversation`, et le test qui suit l'a prouvé : ce
  // sous-routeur commence par `if (deps.conversations === undefined) return null`
  // et rend donc 404 sur un déploiement sans gestionnaire de conversations. Les
  // rappels vivent dans le REGISTRE, pas dans une session — exactement le piège
  // déjà documenté pour les mandats, reproduit une seconde fois.
  const rappels = chemin.match(/^\/orchestrator\/conversations\/([^/]+)\/rappels$/);
  if (rappels?.[1] !== undefined) {
    // Bornée au fil demandé : même isolation que côté MCP, portée par la requête
    // et non par une vérification qu'un futur chemin pourrait contourner.
    const liste = deps.registre.rappels.duFil(decodeURIComponent(rappels[1]), true);
    return enveloppe(pcOnline, liste.map(versRappelApi));
  }

  // `☠` AVANT les routes de conversation, comme les rappels : le sous-routeur
  // ci-dessous court-circuite tout dès qu'aucun gestionnaire n'est assemblé. Les
  // machines vivent dans le LIEN, pas dans une session — les y enterrer
  // rendrait le sélecteur vide sur un déploiement sans orchestrateur.
  if (chemin === '/machines') {
    return enveloppe(pcOnline, deps.machines?.() ?? []);
  }

  const conversation = routerLectureConversation(chemin, url, deps, pcOnline);
  if (conversation !== null) return conversation;

  if (chemin === '/missions') {
    // `☠` La LISTE porte aussi ses sous-agents : sans eux, la carte du parc
    // affiche « lead seul » sur une équipe de cinq, et l'écart avec la vue
    // détail passe pour un bug d'affichage.
    const missions = deps.registre.missions
      .listerRecentes()
      .map((m) => versMissionApi(m, plafond, maintenant, [], deps.registre.missions.sousAgents(m.id)));
    return enveloppe(pcOnline, missions);
  }

  const mission = chemin.match(/^\/missions\/([^/]+)$/);
  if (mission?.[1] !== undefined) {
    const trouvee = deps.registre.missions.lire(decodeURIComponent(mission[1]));
    // `☠` Une mission inconnue avec le PC EN LIGNE est un vrai 404 ; le PC
    // absent ne doit jamais transformer « inconnue » en « peut-être plus tard ».
    if (trouvee === null) throw introuvable('mission');
    const feed = construireFeed(deps.registre, trouvee.id);
    return enveloppe(
      pcOnline,
      versMissionApi(trouvee, plafond, maintenant, feed, deps.registre.missions.sousAgents(trouvee.id)),
    );
  }

  // `☠` Route RÉELLE du détail d'un sous-agent. Le client interrogeait jusqu'ici
  // le jeu de DÉMO (`findAgent` sur `db` dans `harness-api.js`) : cliquer sur un
  // sous-agent réel rendait « Sous-agent introuvable », alors que la mission
  // l'affichait juste au-dessus (constaté 23/07, premier vrai dispatch).
  const agent = chemin.match(/^\/missions\/([^/]+)\/agents\/([^/]+)$/);
  if (agent?.[1] !== undefined && agent[2] !== undefined) {
    const missionId = decodeURIComponent(agent[1]);
    const agentId = decodeURIComponent(agent[2]);
    const trouve = deps.registre.missions.sousAgents(missionId).find((a) => a.agentId === agentId);
    if (trouve === undefined) throw introuvable('sous-agent');
    return enveloppe(
      pcOnline,
      versSubagentDetailApi(trouve, deps.registre.missions.activitesSousAgent(missionId, agentId)),
    );
  }

  if (chemin === '/accounts') {
    const comptes = deps.registre.comptes
      .lister()
      .map((c) => versAccountApi(c, deps.registre.comptes.listerQuotas(c.id), maintenant));
    return enveloppe(pcOnline, comptes);
  }

  if (chemin === '/modeles') {
    // `☠` Le sélecteur de l'orchestrateur lisait encore la MAQUETTE
    // (`harness-mock-data.js`) : les modèles proposés à l'écran n'avaient aucun
    // rapport avec ce que le CLI accepte, et les niveaux de raisonnement étaient
    // les mêmes pour tous — alors que Haiku n'en accepte AUCUN et que `xhigh`
    // n'existe pas avant Opus 4.7. Source unique : `shared/modeles-claude.ts`.
    return enveloppe(
      pcOnline,
      MODELES.map((m) => ({
        id: m.id,
        label: m.libelle,
        alias: m.alias,
        // Tout le catalogue est sélectionnable : la disponibilité réelle dépend
        // de l'abonnement du compte, et le CLI la tranche à l'usage.
        enabled: true,
        effort: [...m.efforts],
        effortDefaut: m.effortDefaut,
        fastMode: m.modeRapide,
        note: m.note,
      })),
    );
  }

  if (chemin === '/orchestrator/propositions') {
    const liste = deps.mandats === undefined ? [] : deps.mandats.enAttente();
    return enveloppe(pcOnline, liste);
  }

  if (chemin === '/orchestrator/gauges') {
    // `☠` Le contexte vient de la VRAIE sentinelle. `null` (orchestrateur
    // inactif ou pas encore de mesure) ⇒ `contextPct: null`, jamais un chiffre
    // inventé — l'ancienne UI affichait « 23 % » codé en dur, ce qui mentait.
    const ratio = deps.orchestrateurContexteRatio?.() ?? null;
    return enveloppe(pcOnline, {
      contextPct: ratio === null ? null : Math.round(ratio * 100),
      active: deps.orchestrateurContexteRatio !== undefined,
    });
  }

  if (chemin === '/notifications') {
    // `☠` `conversationId` est rendu tel quel : c'est lui qui fait du clic sur
    // une notification une redirection vers le BON fil. Sans lui, l'interface
    // n'aurait qu'un texte à afficher et Chris devrait retrouver la
    // conversation lui-même — la moitié de l'intérêt de la fonctionnalité.
    return enveloppe(pcOnline, {
      notifications: deps.registre.notifications.recentes().map(versNotificationApi),
      unread: deps.registre.notifications.nombreNonLues(),
    });
  }

  if (chemin === '/health') {
    return { ok: true, pcOnline };
  }

  throw new ErreurApi(404, `route inconnue : ${chemin}`);
}

async function lireCorps(req: Request): Promise<Record<string, unknown>> {
  try {
    const brut: unknown = await req.json();
    if (brut !== null && typeof brut === 'object') return brut as Record<string, unknown>;
  } catch {
    // Corps vide ou illisible : accepté, la plupart des ordres n'en ont pas.
  }
  return {};
}

/**
 * Écritures sur les conversations. `☠` Ne dépendent PAS du PC — elles touchent la
 * session orchestrateur sur le Pi. Traitées AVANT le garde `pc` du routage
 * d'ordres, sinon un déploiement sans PC les refuserait à tort. `null` = pas une
 * route conversation.
 */
async function routerEcritureConversation(chemin: string, req: Request, deps: DependancesApiWeb): Promise<unknown> {
  // `☠` Les mandats sont traités AVANT le filtre sur `/orchestrator/conversations` :
  // placés après, ils n'étaient jamais atteints (404 « route inconnue »), et le
  // bouton d'autorisation ne pouvait rien faire.
  const mandat = chemin.match(/^\/orchestrator\/propositions\/([^/]+)\/(approve|reject)$/);
  if (mandat?.[1] !== undefined && mandat[2] !== undefined) {
    if (deps.mandats === undefined) throw new ErreurApi(501, "autorisation des mandats non câblée sur ce déploiement");
    const id = decodeURIComponent(mandat[1]);
    if (mandat[2] === 'reject') {
      if (!deps.mandats.refuser(id)) throw new ErreurApi(409, 'mandat déjà tranché ou inconnu');
      return { ok: true, effet: 'mandat refusé — aucune équipe créée' };
    }
    // `☠` L'approbation DISPATCHE réellement : un échec doit remonter tel quel,
    // jamais être maquillé en succès — l'opérateur croirait son équipe lancée.
    try {
      const r = await deps.mandats.approuver(id);
      return { ok: true, effet: r.detail, missionId: r.missionId };
    } catch (erreur) {
      // `☠` Une règle métier connue n'est PAS une panne. « Une équipe est déjà
      // active sur ce projet » (H-56) remontait en 500 « erreur interne du
      // control plane » : l'opérateur a cliqué trois fois sans jamais savoir
      // pourquoi rien ne partait (prod, 23/07). 409 + le motif exact.
      if (erreur instanceof ErreurProjetOccupe) throw new ErreurApi(409, erreur.message);
      // `☠` Même famille, deuxième occurrence (prod, 01/08) : le mandat a été
      // tranché entre l'affichage de la carte et le clic — auto-approbation, ou
      // approbation depuis un autre écran. Un geste arrivé trop tard, pas une
      // panne ; le dire évite de faire douter d'une équipe qui tourne.
      if (erreur instanceof ErreurMandatDejaTranche) throw new ErreurApi(409, erreur.message);
      // `☠` Même famille, TROISIÈME occurrence (prod, 01/08, banc multi-machines).
      // « Ce projet n'est pas sur cette machine » et « cette machine est hors
      // ligne » sont des refus PARFAITEMENT connus, produits exprès avant toute
      // écriture. Sortis en 500 « erreur interne », ils envoyaient chercher une
      // panne du control plane là où il n'y avait qu'un mandat mal adressé — et
      // le message actionnable, écrit pour être lu, restait dans le journal du
      // Pi. Le mécanisme du refus marchait ; sa TRANSMISSION n'existait pas.
      if (erreur instanceof ErreurProjetAbsentDeLaMachine) throw new ErreurApi(409, erreur.message);
      if (erreur instanceof ErreurRoutageMachine) throw new ErreurApi(409, erreur.message);
      throw erreur;
    }
  }

  // Rappels d'un fil (migration 16) — pause, reprise, suppression depuis l'écran.
  // `☠` La CRÉATION et la MODIFICATION de consigne n'ont volontairement pas de
  // route : la consigne est un texte réinjecté à l'orchestrateur, qui doit
  // pouvoir l'exploiter sans contexte. C'est lui qui la rédige, avec ses outils.
  // L'écran donne la visibilité et le contrôle, pas la plume.
  const rappelAction = chemin.match(/^\/orchestrator\/conversations\/([^/]+)\/rappels\/([^/]+)\/(pause|resume|delete)$/);
  if (rappelAction?.[1] !== undefined && rappelAction[2] !== undefined && rappelAction[3] !== undefined) {
    const conversationId = decodeURIComponent(rappelAction[1]);
    const rappelId = decodeURIComponent(rappelAction[2]);
    const depot = deps.registre.rappels;
    // Le type vient du motif de la route, pas d'un cast de confort : les trois
    // valeurs sont celles de la regex, il n'y en a pas d'autre possible.
    const action = rappelAction[3] as 'pause' | 'resume' | 'delete';
    const fait =
      action === 'pause'
        ? depot.mettreEnPause(rappelId, conversationId)
        : action === 'resume'
          ? depot.reprendre(rappelId, conversationId)
          : depot.supprimer(rappelId, conversationId);
    // `☠` 409 et non 200 : un « rien n'a changé » rendu comme un succès ferait
    // croire à Chris qu'il a coupé un rappel qui continue de tirer.
    if (!fait) {
      throw new ErreurApi(409, `rappel introuvable dans ce fil, ou état incompatible avec « ${action} »`);
    }
    const effets = {
      pause: 'rappel en pause — consigne et historique conservés',
      resume: 'rappel repris — le cycle repart de maintenant',
      delete: 'rappel supprimé définitivement',
    } as const;
    return { ok: true, effet: effets[action] };
  }

  // Fenêtre d'autonomie d'un fil (migration 15) — pose ou retrait.
  const fenetre = chemin.match(/^\/orchestrator\/conversations\/([^/]+)\/autonomie$/);
  if (fenetre?.[1] !== undefined) {
    const id = decodeURIComponent(fenetre[1]);
    const corps = await lireCorps(req);
    const debut = typeof corps['start'] === 'number' ? corps['start'] : null;
    const fin = typeof corps['end'] === 'number' ? corps['end'] : null;
    const objectif = typeof corps['goal'] === 'string' ? corps['goal'] : null;
    // `☠` Refus AVANT écriture, et message explicite : une fenêtre dont la fin
    // précède le début serait posée sans jamais s'ouvrir — l'opérateur croirait
    // avoir délégué une plage et retrouverait son parc à l'arrêt au matin.
    if (debut !== null && fin !== null && fin <= debut) {
      throw new ErreurApi(400, "la fin de la fenêtre doit suivre son début — sinon elle ne s'ouvre jamais");
    }
    deps.registre.conversations.poserFenetreAutonomie(id, debut, fin, objectif);
    const pose = debut !== null && fin !== null;
    return {
      ok: true,
      effet: pose
        ? `autonomie déléguée du ${new Date(debut).toLocaleString('fr-FR')} au ${new Date(fin).toLocaleString('fr-FR')}`
        : 'autonomie retirée — les mandats de ce fil repassent par la règle du premier clic',
    };
  }

  // `☠` Comme les mandats, AVANT le filtre `/orchestrator/conversations` : ces
  // routes ne touchent pas le PC et ne doivent pas dépendre de son état.
  if (chemin === '/notifications/read-all') {
    const marquees = deps.registre.notifications.toutMarquerLu();
    return { ok: true, effet: `${marquees} notification(s) marquée(s) lue(s)`, marquees };
  }
  const luNotif = chemin.match(/^\/notifications\/([^/]+)\/read$/);
  if (luNotif?.[1] !== undefined) {
    const id = decodeURIComponent(luNotif[1]);
    // Déjà lue ⇒ succès, pas une erreur : deux onglets ouverts sur la même
    // notification produiraient sinon une alerte pour un non-événement.
    const marquee = deps.registre.notifications.marquerLue(id);
    return { ok: true, effet: marquee ? 'notification marquée lue' : 'notification déjà lue', marquee };
  }

  if (!chemin.startsWith('/orchestrator/conversations')) return null;
  if (deps.conversations === undefined) {
    throw new ErreurApi(501, 'session orchestrateur non active sur ce déploiement (CCREMOTE_PI_ORCHESTRATEUR=1)');
  }
  const conv = deps.conversations;

  if (chemin === '/orchestrator/conversations') {
    const corps = await lireCorps(req);
    const titre = typeof corps['titre'] === 'string' ? corps['titre'] : undefined;
    // `☠` La machine est VALIDÉE contre les machines réellement connues, jamais
    // prise telle quelle : elle vient du navigateur, finit en clé de routage et
    // en colonne SQL. Une valeur inconnue ferait un fil irroutable, refusé
    // seulement au premier mandat — bien trop tard pour être compris.
    const machineDemandee = typeof corps['machine'] === 'string' ? corps['machine'] : undefined;
    const connues = (deps.machines?.() ?? []).map((m) => m.id);
    if (machineDemandee !== undefined && machineDemandee !== '' && !connues.includes(machineDemandee)) {
      throw requeteInvalide(
        `machine « ${machineDemandee} » inconnue — machines disponibles : ${connues.length === 0 ? 'aucune' : connues.join(', ')}`,
      );
    }
    const creee = conv.creer(titre, machineDemandee ?? null);
    return { ok: true, effet: 'conversation créée', conversation: versConversationApi({ ...creee, active: false, contextePct: null }) };
  }

  const message = chemin.match(/^\/orchestrator\/conversations\/([^/]+)\/message$/);
  if (message?.[1] !== undefined) {
    const corps = await lireCorps(req);
    const texte = corps['text'];
    if (typeof texte !== 'string' || texte.trim().length === 0) throw requeteInvalide('message vide');
    // `☠` Modèle et effort étaient reçus ici et JETÉS : l'interface proposait un
    // réglage sans le moindre effet, et la session tournait sur sa constante.
    const modele = typeof corps['model'] === 'string' ? corps['model'] : undefined;
    const effort = typeof corps['effort'] === 'string' ? corps['effort'] : undefined;
    // `☠` NE bloque pas jusqu'à la réponse : `envoyer` enfile puis rend la main.
    // La réponse remonte par le streaming (GET .../events). Un POST bloquant
    // jusqu'au `result` immobiliserait le relais et Cloudflare le couperait.
    await conv.envoyer(decodeURIComponent(message[1]), texte, { modele, effort });
    return { ok: true, effet: 'message envoyé — la réponse arrive en streaming' };
  }

  const compact = chemin.match(/^\/orchestrator\/conversations\/([^/]+)\/compact$/);
  if (compact?.[1] !== undefined) {
    // `☠` `compacte: false` n'est PAS une erreur (rien à compacter, tour en
    // cours) : on rend le motif tel quel plutôt qu'un faux succès, l'interface
    // doit pouvoir dire pourquoi il ne s'est rien passé.
    const r = await conv.compacter(decodeURIComponent(compact[1]));
    return { ok: true, effet: r.detail, compacted: r.compacte };
  }

  const rename = chemin.match(/^\/orchestrator\/conversations\/([^/]+)\/rename$/);
  if (rename?.[1] !== undefined) {
    const corps = await lireCorps(req);
    const titre = corps['titre'];
    if (typeof titre !== 'string' || titre.trim().length === 0) throw requeteInvalide('titre vide');
    if (!conv.renommer(decodeURIComponent(rename[1]), titre)) throw introuvable('conversation');
    return { ok: true, effet: 'conversation renommée' };
  }

  const archive = chemin.match(/^\/orchestrator\/conversations\/([^/]+)\/archive$/);
  if (archive?.[1] !== undefined) {
    if (!conv.archiver(decodeURIComponent(archive[1]))) throw introuvable('conversation');
    return { ok: true, effet: 'conversation archivée' };
  }

  throw new ErreurApi(404, `route conversation inconnue : ${chemin}`);
}

/**
 * Routage en écriture. `☠` Sans port vers le PC, on répond 501 — jamais 200 :
 * accepter un ordre qui ne part nulle part est le pire des deux, parce que
 * l'opérateur croit sa mission arrêtée et n'y revient pas.
 */
async function routerEcriture(chemin: string, req: Request, deps: DependancesApiWeb): Promise<unknown> {
  if (deps.pc === undefined) {
    throw new ErreurApi(501, "aucun lien vers le PC sur ce déploiement — l'ordre n'a pas été transmis");
  }
  let corps: Record<string, unknown> = {};
  try {
    const brut: unknown = await req.json();
    if (brut !== null && typeof brut === 'object') corps = brut as Record<string, unknown>;
  } catch {
    // Corps vide ou illisible : accepté, la plupart des ordres n'en ont pas.
  }
  const resultat = await traiterEcriture(chemin, corps, {
    pc: deps.pc,
    orchestrateur: deps.orchestrateur,
    inspection: deps.inspection,
  });
  if (resultat === null) throw new ErreurApi(404, `route d'écriture inconnue : ${chemin}`);
  return resultat;
}

export function demarrerServeurApiWeb(options: OptionsServeurApiWeb): ServeurApiWeb {
  const hostname = options.hostname ?? '127.0.0.1';
  if (HOTES_PUBLICS.has(hostname)) {
    // Échec bruyant plutôt qu'avertissement (H-74, point 2) : ce serveur n'a
    // pas d'authentification, l'exposer publiquement ouvrirait le parc entier.
    throw new Error(
      `refus de démarrer l'API du harness sur ${hostname} : ce serveur n'a aucune authentification propre et doit rester derrière pi-web (127.0.0.1)`,
    );
  }

  // `Server<never>` : ce serveur ne fait AUCUN upgrade WebSocket — le seul lien
  // du Pi est celui vers le PC (`composition/pi/serveur-lien-pc.ts`).
  const server: Server<never> = Bun.serve<never>({
    port: options.port,
    hostname,
    async fetch(req): Promise<Response> {
      const url = new URL(req.url);
      const chemin = url.pathname.replace(/^\/api\/harness/, '');
      try {
        if (req.method === 'POST') {
          const conversation = await routerEcritureConversation(chemin, req, options);
          if (conversation !== null) return json(conversation);
          return json(await routerEcriture(chemin, req, options));
        }
        return json(router(chemin, url, options));
      } catch (erreur) {
        if (erreur instanceof ErreurApi) return json({ error: erreur.message }, erreur.statut);
        // `☠` Une panne du control plane reste une VRAIE erreur HTTP — jamais
        // déguisée en `pcOnline: false`, qui ferait afficher « tout va bien,
        // données un peu vieilles » sur un serveur cassé.
        log.error({ err: erreur, chemin }, "échec interne de l'API du harness");
        return json({ error: 'erreur interne du control plane' }, 500);
      }
    },
  });

  const portEcoute = server.port;
  if (portEcoute === undefined) throw new Error('API du harness démarrée sans port TCP — configuration inattendue');
  log.info({ port: portEcoute, hostname }, "API web du harness démarrée (lecture seule, derrière pi-web)");

  return {
    port: portEcoute,
    arreter: (): void => {
      server.stop(true);
    },
  };
}
