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

interface Etat {
  sessionId: string;
  vivant: boolean;
  modeleResolu: string | null;
  etatSdk: TelemetrieWorker['etatSdk'];
  coutUsd: number;
  contexteTokensUtilises: number | null;
  contexteTokensMax: number | null;
  contexteVentilation: readonly PosteContexte[] | null;
  derniereActivite: string | null;
  /** Activités produites, en attente de rapatriement vers le Pi. Vidée à chaque relevé. */
  activitesEnAttente: { texte: string; survenuA: number; type: NatureActivite; outil?: string }[];
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
   * précédent et ne se termine plus jamais.
   */
  tachesFond: readonly { readonly taskId: string; readonly type: string; readonly description: string }[];
  quotaSature: boolean;
  motifQuota: string | null;
  observeA: number;
}

/**
 * `☠` Motifs de saturation observés en RÉEL (23/07) : le CLI annonce la limite
 * en clair dans un message système, et le worker enchaîne ensuite des
 * `api_error` sans jamais produire de `result`. Sans cette détection, le harness
 * relance indéfiniment sur un compte qui ne répondra plus — c'est ce qui a fait
 * passer une équipe entière pour « en cours » sans une seule réponse.
 */
const MOTIFS_SATURATION: readonly RegExp[] = [
  /spend limit/i,
  /usage limit/i,
  /rate limit/i,
  /quota exceeded/i,
  /limite de d[ée]pense/i,
];

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
  for (const bloc of contenu as { type?: string; text?: string; thinking?: string; name?: string; input?: unknown }[]) {
    if (bloc.type === 'text' && typeof bloc.text === 'string' && bloc.text.trim().length > 0) {
      // JAMAIS tronqué — c'est le livrable.
      prises.push({ texte: bloc.text.trim(), type: 'texte' });
    } else if (bloc.type === 'thinking' && typeof bloc.thinking === 'string' && bloc.thinking.trim().length > 0) {
      prises.push({ texte: bloc.thinking.trim().slice(0, REFLEXION_MAX), type: 'reflexion' });
    } else if (bloc.type === 'tool_use' && typeof bloc.name === 'string') {
      const resume = resumerEntreeOutil(bloc.input);
      prises.push({ texte: resume.length > 0 ? resume : bloc.name, type: 'outil', outil: bloc.name });
    }
  }
  return prises;
}

/** Dernier texte visible, pour l'aperçu court rendu au master (H-45). */
function apercuTexte(prises: readonly PriseActivite[]): string | null {
  const dernier = [...prises].reverse().find((p) => p.type === 'texte');
  return dernier === undefined ? null : dernier.texte.slice(0, APERCU_MAX);
}

export class CollecteurTelemetrie {
  readonly #par = new Map<string, Etat>();

  /** Déclare un worker dès son démarrage : il apparaît avant son premier message. */
  ouvrir(missionId: string, sessionId: string, maintenant: number = Date.now()): void {
    this.#par.set(missionId, {
      sessionId,
      vivant: true,
      modeleResolu: null,
      etatSdk: 'running',
      coutUsd: 0,
      contexteTokensUtilises: null,
      contexteTokensMax: null,
      contexteVentilation: null,
      derniereActivite: null,
      activitesEnAttente: [],
      sousAgents: [],
      tachesFond: [],
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
      this.#appliquer(etat, message);
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
  aDesTachesFond(missionId: string): boolean {
    return (this.#par.get(missionId)?.tachesFond.length ?? 0) > 0;
  }

  /** Relevé disque des sous-agents (`sous-agents-disque.ts`), posé par le superviseur. */
  poserSousAgents(missionId: string, sousAgents: readonly SousAgentObserve[]): void {
    const etat = this.#par.get(missionId);
    if (etat === undefined) return;
    etat.sousAgents = sousAgents;
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
    etat.etatSdk = 'idle';
    etat.observeA = maintenant;
  }

  /**
   * `☠` DRAINANT : les activités rendues sont retirées de la file. Le relevé est
   * consommé une fois — les relire à chaque passage de balayage dupliquerait
   * chaque message du lead dans le fil toutes les 5 secondes.
   */
  tous(): readonly TelemetrieWorker[] {
    return [...this.#par.entries()].map(([missionId, e]) => {
      const activites = e.activitesEnAttente;
      e.activitesEnAttente = [];
      return { missionId, ...e, activitesEnAttente: activites };
    });
  }

  #appliquer(etat: Etat, message: SDKMessage): void {
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
      if (MOTIFS_SATURATION.some((m) => m.test(texte))) {
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
      return;
    }

    if (sonde.type === 'system' && sonde.subtype === 'init') {
      // `☠` Rien n'est émis au démarrage : l'ensemble des tâches de fond DOIT
      // repartir vide quand le process CLI (re)démarre, sinon un worker relancé
      // hérite des tâches du précédent et n'est plus jamais tenu pour fini.
      etat.tachesFond = [];
      // Le modèle résolu n'est connu qu'ici : le CLI peut résoudre un alias
      // (`opus`) vers un identifiant précis, et c'est celui-là qui compte.
      if (typeof sonde.model === 'string') etat.modeleResolu = sonde.model;
      return;
    }

    if (sonde.type === 'assistant') {
      etat.etatSdk = 'running';
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
      etat.etatSdk = 'idle';
      // `☠` Valeur ABSOLUE rendue par le SDK, jamais une somme maison : additionner
      // les tours ferait dériver le total dès qu'un message est manqué.
      if (typeof sonde.total_cost_usd === 'number') etat.coutUsd = sonde.total_cost_usd;
    }
  }
}
