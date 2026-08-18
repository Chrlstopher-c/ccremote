/**
 * Responsabilité : retenir, côté PC, ce que le flux SDK d'un worker apprend et
 * que le Pi ne peut pas deviner — modèle réellement résolu, état, coût cumulé,
 * usage de contexte, dernière activité.
 *
 * `☠` Le PC fait autorité sur ces valeurs (B.1.4) : elles n'existent que dans le
 * flux, et le flux n'existe qu'ici. Avant ce collecteur, l'interface affichait
 * « (non résolu) », un coût à 0 et un contexte à 0 sur des équipes qui
 * travaillaient réellement.
 *
 * `☠` Ne lève JAMAIS : alimenté depuis la boucle de lecture d'un worker. Une
 * exception ici arrêterait la surveillance de la mission — le prix d'un chiffre
 * d'affichage ne peut pas être la perte du pilotage.
 */

import { annonceSaturation } from '../shared/saturation-compte.ts';
import type { SousAgentObserve } from './sous-agents-disque.ts';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type { NatureActivite, PosteContexte, TelemetrieWorker } from './types.ts';
import { superviseurLogger } from './logger.ts';

const log = superviseurLogger.child({ composant: 'collecteur-telemetrie' });

/**
 * Longueur retenue de l'aperçu rendu à l'ORCHESTRATEUR — un aperçu, jamais un
 * transcript (H-45) : son contexte ne doit pas se remplir du travail des autres.
 */
const APERCU_MAX = 240;

/**
 * `☠` Le TEXTE d'un lead n'est PAS tronqué. Une synthèse de fin coupée en son
 * milieu ne vaut rien : c'est le livrable de l'équipe, on le rapatrie entier
 * (décision de l'opérateur, 23/07). La borne au flux tient ailleurs — H-45 vaut
 * pour ce qu'on donne au MASTER, pas pour ce qu'on stocke.
 *
 * La réflexion et les appels d'outils, eux, restent bornés : ils servent à
 * SUIVRE la progression, pas à être relus intégralement, et un `tool_use` peut
 * porter un fichier entier en argument.
 */
const REFLEXION_MAX = 2_000;
const OUTIL_MAX = 400;

/**
 * Combien de prises d'activité on garde en attente de rapatriement. `☠` Bornée :
 * le balayage passe toutes les 5 s, un lead bavard produirait sinon une file
 * sans fin en mémoire du PC.
 */
const FILE_ACTIVITE_MAX = 50;

/**
 * Patience accordée à une tâche de fond avant de cesser de la tenir pour vivante.
 *
 * `☠` Ce plafond existe pour ne pas troquer une panne contre son exact opposé.
 * Tenir une équipe éveillée tant qu'une tâche de fond est annoncée est juste pour
 * des sous-agents — ils rendent en minutes. Ça ne l'est pas pour un `Bash` détaché
 * (`bun run dev` lancé pour tester, cas très courant en fin de mission) : celui-là
 * ne s'éteint jamais, et sans borne l'équipe ne serait plus JAMAIS déclarée finie,
 * ni close automatiquement — son projet resterait verrouillé à vie (H-56).
 *
 * `☠` Chiffre CHOISI, pas mesuré, et l'arbitrage est le même que celui de
 * `politique-cloture.ts` : dépasser coûte une relance (le `sessionId` survit),
 * couper trop tôt coûte du travail. Vingt minutes couvrent très largement des
 * sous-agents réels — les six équipes du 02/08 n'ont jamais dépassé quatre minutes
 * d'attente — et la clôture automatique n'intervient que quinze minutes après.
 */
const PATIENCE_TACHES_FOND_MS = 20 * 60_000;

interface Etat {
  sessionId: string;
  vivant: boolean;
  modeleResolu: string | null;
  coutUsd: number;
  contexteTokensUtilises: number | null;
  contexteTokensMax: number | null;
  contexteVentilation: readonly PosteContexte[] | null;
  derniereActivite: string | null;
  /** Activités produites, en attente de rapatriement vers le Pi. Vidée à chaque relevé. */
  activitesEnAttente: { texte: string; survenuA: number; type: NatureActivite; outil?: string; outilId?: string }[];
  resultatsEnAttente: { outilId: string; resultat: string; estErreur: boolean }[];
  /**
   * Dernier relevé disque des sous-agents. `☠` Posé de l'extérieur (le
   * collecteur ne lit pas le disque), et NON drainant contrairement aux
   * activités : c'est un état courant complet, pas un flux d'évènements.
   */
  sousAgents: readonly SousAgentObserve[];
  /**
   * Tâches de fond VIVANTES, telles que le dernier `background_tasks_changed`
   * les a décrites.
   *
   * `☠` Signal de NIVEAU, sémantique REPLACE imposée par le SDK : on remplace
   * l'ensemble à chaque message, on n'apparie jamais des débuts et des fins. Le
   * SDK le dit explicitement — apparier des bornes laisse un indicateur coincé
   * en « ça tourne » dès qu'une borne se perd.
   *
   * `☠` Rien n'est émis au démarrage : l'ensemble DOIT repartir vide à chaque
   * (re)démarrage du process CLI, sinon un worker relancé hérite des tâches du
   * précédent et ne se termine plus jamais. C'est le SUPERVISEUR qui le dit
   * (`ouvrir`, `reinitialiserTachesFond`) — jamais un message du flux, voir la
   * branche `init` de `#appliquer`.
   */
  tachesFond: readonly { readonly taskId: string; readonly type: string; readonly description: string }[];
  /** Dernier instant où le SDK a annoncé un ensemble de tâches NON vide. */
  tachesFondVuesA: number;
  /**
   * Le dernier `result` reçu n'a pas encore été suivi d'un message `assistant`.
   *
   * `☠` « Tour fini » et « au repos » sont DEUX choses : un lead qui a délégué en
   * arrière-plan puis rendu la main a fini son tour et travaille encore. Seul ce
   * FAIT est mémorisé ; `etatSdk` s'en déduit à la lecture (`etatSdkEffectif`).
   */
  tourFini: boolean;
  quotaSature: boolean;
  motifQuota: string | null;
  observeA: number;
}

/**
 * Champs d'entrée d'outil réellement parlants pour un humain qui suit une
 * mission. `☠` On ne dumpe JAMAIS l'entrée complète : un `Write` porte le
 * fichier entier, un `Edit` deux versions — le fil deviendrait illisible et la
 * base grossirait sans raison. On rend ce qui dit « ce qu'il fait, sur quoi ».
 */
const CHAMPS_OUTIL: readonly string[] = [
  'description',
  'command',
  'file_path',
  'path',
  'pattern',
  'query',
  'url',
  'prompt',
  'notebook_path',
];

function resumerEntreeOutil(entree: unknown): string {
  if (typeof entree !== 'object' || entree === null) return '';
  const source = entree as Record<string, unknown>;
  const parties: string[] = [];
  for (const champ of CHAMPS_OUTIL) {
    const valeur = source[champ];
    if (typeof valeur === 'string' && valeur.trim().length > 0) parties.push(`${champ}=${valeur.trim()}`);
  }
  return parties.join(' · ').slice(0, OUTIL_MAX);
}

interface PriseActivite {
  readonly texte: string;
  readonly type: NatureActivite;
  readonly outil?: string;
  readonly outilId?: string;
}

/** Un résultat d'outil, apparié plus tard à son appel par `outilId`. */
interface PriseResultat {
  readonly outilId: string;
  readonly resultat: string;
  readonly estErreur: boolean;
}

/**
 * Taille retenue d'un résultat d'outil.
 *
 * `☠` Borné, et haut : un `Read` renvoie un fichier entier, un `Bash` peut
 * cracher des mégaoctets. Sans borne, une seule mission remplirait la base du
 * Pi — qui tient sur une carte SD. 6 000 caractères couvrent la quasi-totalité
 * des sorties utiles ; au-delà, la troncature est ANNONCÉE dans le texte, jamais
 * silencieuse : un opérateur qui lit une sortie coupée sans le savoir en tire
 * des conclusions fausses.
 */
const RESULTAT_MAX = 6000;

/** Aplatit le contenu d'un `tool_result` : chaîne, ou blocs typés. */
function texteResultat(contenu: unknown): string {
  if (typeof contenu === 'string') return contenu;
  if (!Array.isArray(contenu)) return '';
  return (contenu as { type?: string; text?: string }[])
    .filter((b) => b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text as string)
    .join('\n');
}

/**
 * Extrait les résultats d'outils d'un message `user`.
 *
 * `☠` Ces messages étaient purement IGNORÉS : le collecteur ne traitait que
 * `assistant`, `system` et `result`. On voyait donc CE QUE le lead lançait, mais
 * jamais ce que ça avait donné — l'écran montrait la question, jamais la réponse.
 */
function prisesResultat(message: SDKMessage): readonly PriseResultat[] {
  if (message.type !== 'user') return [];
  const contenu = (message as { message?: { content?: unknown } }).message?.content;
  if (!Array.isArray(contenu)) return [];
  const prises: PriseResultat[] = [];
  for (const bloc of contenu as { type?: string; tool_use_id?: string; content?: unknown; is_error?: boolean }[]) {
    if (bloc.type !== 'tool_result' || typeof bloc.tool_use_id !== 'string') continue;
    const brut = texteResultat(bloc.content).trim();
    if (brut.length === 0) continue;
    const coupe = brut.length > RESULTAT_MAX;
    prises.push({
      outilId: bloc.tool_use_id,
      resultat: coupe ? `${brut.slice(0, RESULTAT_MAX)}\n\n[… sortie tronquée à ${RESULTAT_MAX} caractères]` : brut,
      estErreur: bloc.is_error === true,
    });
  }
  return prises;
}

/**
 * Décompose un message assistant en prises d'activité. `☠` Un seul message peut
 * porter à la fois de la réflexion, du texte et plusieurs appels d'outils : les
 * fusionner en une ligne effacerait justement la progression que l'opérateur
 * veut voir.
 */
function prisesAssistant(message: SDKMessage): readonly PriseActivite[] {
  if (message.type !== 'assistant') return [];
  const contenu = (message as { message?: { content?: unknown } }).message?.content;
  if (!Array.isArray(contenu)) return [];
  const prises: PriseActivite[] = [];
  for (const bloc of contenu as { type?: string; text?: string; thinking?: string; name?: string; input?: unknown; id?: string }[]) {
    if (bloc.type === 'text' && typeof bloc.text === 'string' && bloc.text.trim().length > 0) {
      // JAMAIS tronqué — c'est le livrable.
      prises.push({ texte: bloc.text.trim(), type: 'texte' });
    } else if (bloc.type === 'thinking' && typeof bloc.thinking === 'string' && bloc.thinking.trim().length > 0) {
      prises.push({ texte: bloc.thinking.trim().slice(0, REFLEXION_MAX), type: 'reflexion' });
    } else if (bloc.type === 'tool_use' && typeof bloc.name === 'string') {
      const resume = resumerEntreeOutil(bloc.input);
      prises.push({
        texte: resume.length > 0 ? resume : bloc.name,
        type: 'outil',
        outil: bloc.name,
        ...(typeof bloc.id === 'string' ? { outilId: bloc.id } : {}),
      });
    }
  }
  return prises;
}

/** Dernier texte visible, pour l'aperçu court rendu au master (H-45). */
function apercuTexte(prises: readonly PriseActivite[]): string | null {
  const dernier = [...prises].reverse().find((p) => p.type === 'texte');
  return dernier === undefined ? null : dernier.texte.slice(0, APERCU_MAX);
}

/**
 * Une tâche de fond est-elle encore à attendre ?
 *
 * `☠` Deux conditions, jamais une seule : l'ensemble annoncé n'est pas vide, ET
 * cette annonce n'est pas périmée. La seconde est ce qui empêche un `Bash`
 * détaché de rendre une équipe immortelle (voir `PATIENCE_TACHES_FOND_MS`).
 */
function tachesFondVivantes(etat: Etat, maintenant: number): boolean {
  if (etat.tachesFond.length === 0) return false;
  return maintenant - etat.tachesFondVuesA < PATIENCE_TACHES_FOND_MS;
}

/**
 * `etatSdk` DÉRIVÉ, jamais mémorisé : au repos = tour rendu ET plus aucune tâche
 * de fond à attendre.
 *
 * `☠` Une seule source. Deux écritures indépendantes du même champ finissent
 * toujours par diverger — la panne du 02/08 est née exactement comme ça, un
 * `result` posant `idle` sans rien savoir des sous-agents encore en vol.
 */
function etatSdkEffectif(etat: Etat, maintenant: number): TelemetrieWorker['etatSdk'] {
  if (!etat.vivant) return 'idle';
  if (!etat.tourFini) return 'running';
  return tachesFondVivantes(etat, maintenant) ? 'running' : 'idle';
}

export class CollecteurTelemetrie {
  readonly #par = new Map<string, Etat>();

  /** Déclare un worker dès son démarrage : il apparaît avant son premier message. */
  ouvrir(missionId: string, sessionId: string, maintenant: number = Date.now()): void {
    this.#par.set(missionId, {
      sessionId,
      vivant: true,
      modeleResolu: null,
      coutUsd: 0,
      contexteTokensUtilises: null,
      contexteTokensMax: null,
      contexteVentilation: null,
      derniereActivite: null,
      activitesEnAttente: [],
      resultatsEnAttente: [],
      sousAgents: [],
      tachesFond: [],
      tachesFondVuesA: maintenant,
      tourFini: false,
      quotaSature: false,
      motifQuota: null,
      observeA: maintenant,
    });
  }

  /** Poussé pour CHAQUE message lu du worker. Ne lève jamais. */
  ingerer(missionId: string, message: SDKMessage, maintenant: number = Date.now()): void {
    const etat = this.#par.get(missionId);
    if (etat === undefined) return;
    try {
      this.#appliquer(etat, message, maintenant);
      etat.observeA = maintenant;
    } catch (erreur) {
      log.error({ err: erreur, missionId }, 'télémétrie ignorée sur ce message — surveillance préservée');
    }
  }

  /**
   * Pose l'usage de contexte, mesuré séparément. `☠` Il n'est PAS dans le message
   * `result` : c'est une requête de contrôle (`getContextUsage`), et elle n'est
   * valable que pendant que la session vit — après le `result`, le transport est
   * fermé (fait mesuré le 22/07).
   */
  /**
   * Des tâches de fond tournent-elles encore pour cette mission ? C'est ce qui
   * autorise, ou non, à traiter un `result` comme une fin de session.
   */
  aDesTachesFond(missionId: string, maintenant: number = Date.now()): boolean {
    const etat = this.#par.get(missionId);
    return etat === undefined ? false : tachesFondVivantes(etat, maintenant);
  }

  /**
   * Nouveau process CLI pour cette mission (relance B.3.3) : les tâches de fond
   * du process précédent ne sont plus les siennes.
   *
   * `☠` Existe parce que `relancer()` ne repasse PAS par `ouvrir()` — il remplace
   * l'enregistrement sans toucher à l'état de télémétrie. Sans cet appel, retirer
   * la remise à zéro de la branche `init` ferait hériter un worker relancé des
   * tâches de son prédécesseur : plus jamais tenu pour fini, projet verrouillé.
   */
  reinitialiserTachesFond(missionId: string): void {
    const etat = this.#par.get(missionId);
    if (etat === undefined) return;
    etat.tachesFond = [];
  }

  /** Relevé disque des sous-agents (`sous-agents-disque.ts`), posé par le superviseur. */
  poserSousAgents(missionId: string, sousAgents: readonly SousAgentObserve[]): void {
    const etat = this.#par.get(missionId);
    if (etat === undefined) return;
    etat.sousAgents = sousAgents;
  }

  /**
   * Coût relevé EN COURS DE TOUR, par requête de contrôle sur la session vivante.
   *
   * `☠` Le coût ne se lisait que sur un message `result`, qui n'arrive qu'à la
   * FIN d'un tour. Une équipe travaillant quinze minutes sur une seule
   * instruction n'en produit aucun avant d'avoir fini : l'orchestrateur voyait
   * 0,00 $ constant pendant tout le travail, et l'anti-boucle — nourri au même
   * endroit — ne pouvait inspecter personne pendant ce temps. Mesuré le 01/08.
   *
   * `☠` Monotone : on ne redescend JAMAIS. Une sonde ratée rend 0, et écrire ce
   * zéro effacerait un coût réel — puis le lui ferait « refranchir » ses paliers,
   * donc réinspecter pour rien. Un coût ne décroît pas dans la vraie vie.
   */
  poserCout(missionId: string, coutUsd: number): void {
    const etat = this.#par.get(missionId);
    if (etat === undefined) return;
    if (!Number.isFinite(coutUsd) || coutUsd <= etat.coutUsd) return;
    etat.coutUsd = coutUsd;
  }

  poserContexte(
    missionId: string,
    utilises: number,
    max: number | null,
    ventilation: readonly PosteContexte[] | null = null,
  ): void {
    const etat = this.#par.get(missionId);
    if (etat === undefined) return;
    etat.contexteTokensUtilises = utilises;
    if (max !== null) etat.contexteTokensMax = max;
    if (ventilation !== null) etat.contexteVentilation = ventilation;
  }

  /** Le worker est mort : on garde son dernier état connu, marqué non vivant. */
  fermer(missionId: string, maintenant: number = Date.now()): void {
    const etat = this.#par.get(missionId);
    if (etat === undefined) return;
    etat.vivant = false;
    etat.observeA = maintenant;
  }

  /**
   * `☠` DRAINANT : les activités rendues sont retirées de la file. Le relevé est
   * consommé une fois — les relire à chaque passage de balayage dupliquerait
   * chaque message du lead dans le fil toutes les 5 secondes.
   */
  tous(maintenant: number = Date.now()): readonly TelemetrieWorker[] {
    return [...this.#par.entries()].map(([missionId, e]) => {
      const activites = e.activitesEnAttente;
      e.activitesEnAttente = [];
      // `☠` Drainé comme les activités : ce qui est rendu ne repassera pas. Le
      // laisser en place ferait réappliquer les mêmes résultats à chaque passage.
      const resultats = e.resultatsEnAttente;
      e.resultatsEnAttente = [];
      return this.#construireVue(missionId, e, maintenant, activites, resultats);
    });
  }

  /**
   * `☠` NON drainant, contrairement à `tous()` : rend l'état COURANT d'UNE
   * mission sans vider ses files d'activités ni de résultats.
   *
   * Existe pour tout appelant qui ne veut lire qu'un champ scalaire (coût,
   * contexte…) sans participer au balayage périodique qui rapatrie le fil vers
   * le Pi — `tous()` PURGE ce fil pour la mission entière du process, pas
   * seulement pour l'appelant. Un appel de fin de mission qui utiliserait
   * `tous()` détruirait, avant que le balayage suivant (5 s) ne l'écrive en
   * base, la dernière activité tout juste ingérée — y compris le message final
   * du lead (mesuré : c'est exactement ce que faisait `#enfilerApprentissageSiConfigure`
   * avant ce correctif).
   */
  lire(missionId: string, maintenant: number = Date.now()): TelemetrieWorker | null {
    const e = this.#par.get(missionId);
    if (e === undefined) return null;
    return this.#construireVue(missionId, e, maintenant, e.activitesEnAttente, e.resultatsEnAttente);
  }

  #construireVue(
    missionId: string,
    e: Etat,
    maintenant: number,
    activites: Etat['activitesEnAttente'],
    resultats: Etat['resultatsEnAttente'],
  ): TelemetrieWorker {
    // `☠` L'état SDK est calculé À LA LECTURE, pas mémorisé : la péremption des
    // tâches de fond dépend du TEMPS QUI PASSE, et aucun message n'arrive pour
    // l'annoncer. Un état figé à la dernière ingestion resterait « running »
    // pour toujours derrière une tâche qui ne s'éteint jamais.
    // `tourFini` et `tachesFondVuesA` restent internes : ils n'ont de sens
    // qu'ici, et le relevé traverse le lien vers le Pi.
    const { tourFini, tachesFondVuesA, ...vue } = e;
    return {
      missionId,
      ...vue,
      etatSdk: etatSdkEffectif(e, maintenant),
      activitesEnAttente: activites,
      resultatsEnAttente: resultats,
    };
  }

  #appliquer(etat: Etat, message: SDKMessage, maintenant: number): void {
    const sonde = message as unknown as {
      type: string;
      subtype?: string;
      model?: string;
      total_cost_usd?: number;
      content?: string;
      text?: string;
      usage?: { input_tokens?: number; output_tokens?: number };
    };

    if (sonde.type === 'system' && (sonde.subtype === 'informational' || sonde.subtype === 'notification')) {
      const texte = typeof sonde.content === 'string' ? sonde.content : (sonde.text ?? '');
      if (annonceSaturation(texte)) {
        etat.quotaSature = true;
        etat.motifQuota = texte.slice(0, APERCU_MAX);
      }
      return;
    }

    // `☠` LE signal qui distingue « le lead a fini » de « le lead attend ses
    // sous-agents ». Sans lui, un `result` émis pendant que des sous-agents
    // tournent était pris pour une fin de mission : l'équipe était déclarée
    // terminée et ses sous-agents mouraient avec elle, en plein travail
    // (mesuré le 23/07 sur une vraie mission — 4 transcripts arrêtés net).
    // REPLACE, jamais un appariement début/fin : c'est la consigne explicite du SDK.
    if (sonde.type === 'system' && sonde.subtype === 'background_tasks_changed') {
      const taches = (message as unknown as { tasks?: { task_id: string; task_type: string; description: string }[] }).tasks;
      etat.tachesFond = Array.isArray(taches)
        ? taches.map((t) => ({ taskId: t.task_id, type: t.task_type, description: t.description }))
        : [];
      // `☠` Horodaté seulement quand l'ensemble est NON vide : c'est la preuve
      // qu'une tâche vivait encore à cet instant, et c'est de cette preuve que
      // court la patience (`PATIENCE_TACHES_FOND_MS`).
      if (etat.tachesFond.length > 0) etat.tachesFondVuesA = maintenant;
      return;
    }

    if (sonde.type === 'system' && sonde.subtype === 'init') {
      // `☠☠ UN `init` N'EST PAS UN DÉMARRAGE DE PROCESS — C'EST UN DÉBUT DE TOUR.
      //
      // Cette branche vidait `tachesFond`, en croyant `init` réservé au (re)spawn
      // du CLI. Mesuré sur banc réel le 02/08 (`acceptation/taches-fond-sousagents-reel.ts`) :
      // le SDK émet un `init` à CHAQUE reprise de tour — notamment juste après la
      // notification d'une tâche de fond terminée, et juste après un `result`.
      //
      // Conséquence, mesurée en production le même jour sur la mission ab7183f0
      // (7,72 $ perdus) : le lead lance quatre sous-agents en arrière-plan, rend
      // la main (`result` n°1, 16:34:14 — la garde tient, quatre tâches vues), le
      // premier sous-agent notifie sa fin à 16:37:48, un `init` de reprise vide
      // ici les trois tâches restantes, et le `result` n°2 de 16:37:51 passe pour
      // une fin de mission. Deux secondes plus tard, les trois derniers
      // sous-agents rendaient leur travail dans une session déjà close.
      //
      // La remise à zéro est donc DITE par le superviseur, qui seul sait qu'il
      // spawne un process (`ouvrir`, `reinitialiserTachesFond`) — jamais déduite
      // d'un message dont ce n'est pas le sens.
      //
      // Le modèle résolu, lui, n'est connu qu'ici : le CLI peut résoudre un alias
      // (`opus`) vers un identifiant précis, et c'est celui-là qui compte.
      if (typeof sonde.model === 'string') etat.modeleResolu = sonde.model;
      return;
    }

    // `☠` Les messages `user` portent les `tool_result`. Placé AVANT la branche
    // `assistant` sans lui être lié : un résultat ne change ni l'état SDK ni le
    // coût, il complète un appel déjà journalisé.
    if (sonde.type === 'user') {
      for (const r of prisesResultat(message)) {
        etat.resultatsEnAttente.push(r);
        if (etat.resultatsEnAttente.length > FILE_ACTIVITE_MAX) etat.resultatsEnAttente.shift();
      }
      return;
    }

    if (sonde.type === 'assistant') {
      etat.tourFini = false;
      const prises = prisesAssistant(message);
      const apercu = apercuTexte(prises);
      if (apercu !== null) etat.derniereActivite = apercu;
      // `☠` Une FILE, pas un simple « dernier » : le balayage passe toutes les
      // 5 s et plusieurs messages peuvent tomber entre deux passages. N'en
      // garder qu'un ferait silencieusement disparaître du fil tout ce que le
      // lead a fait entre-temps — y compris son rapport final.
      const maintenant = Date.now();
      for (const prise of prises) {
        etat.activitesEnAttente.push({ ...prise, survenuA: maintenant });
        if (etat.activitesEnAttente.length > FILE_ACTIVITE_MAX) etat.activitesEnAttente.shift();
      }
      return;
    }

    if (sonde.type === 'result') {
      etat.tourFini = true;
      // `☠` PAS `idle` d'office. Le Pi lit cette transition `running → idle` comme
      // « l'équipe a rendu son travail » : il la notifie à l'orchestrateur, il
      // l'affiche au repos, et la clôture automatique la ferme quinze minutes plus
      // tard (`politique-cloture.ts`). Un lead qui attend ses sous-agents en
      // arrière-plan déclenchait donc les trois — dont un arrêt en plein travail.
      // `☠` Valeur ABSOLUE rendue par le SDK, jamais une somme maison : additionner
      // les tours ferait dériver le total dès qu'un message est manqué.
      // `☠` Monotone, comme la sonde en cours de tour : sur une session reprise le
      // SDK peut repartir d'un total plus bas, et l'écrire ferait refranchir des
      // paliers déjà franchis — donc réinspecter une équipe pour rien.
      if (typeof sonde.total_cost_usd === 'number' && sonde.total_cost_usd > etat.coutUsd) {
        etat.coutUsd = sonde.total_cost_usd;
      }
    }
  }
}
