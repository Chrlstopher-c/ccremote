/**
 * Responsabilité : formes de données du client d'observabilité temps réel
 * (branche E.2 + C.4.2 + F, mission M-50). Aucune I/O ici.
 *
 * Conception imposée par H-72.1/H-72.2/H-72.3 (16-decisions-operateur.md) :
 * DEUX sources, jamais lissées l'une dans l'autre.
 *
 *  - Le FLUX SDK (`forwardSubagentText`, `includePartialMessages`,
 *    `agentProgressSummaries`) est un canal temps réel BEST-EFFORT (H-72.3,
 *    mesuré : 3 à 4 lignes reçues sur 5 sous-agents lancés, jamais les cinq).
 *    Il donne l'arbre de premier niveau via `parent_tool_use_id` — mais AUCUN
 *    message de flux ne porte `parent_agent_id` (absent des types SDK live,
 *    seul `SessionMessage`, lu depuis le store, le porte). `⚠ HYP` documentée
 *    plutôt que devinée : la nidification profonde (sous-agent de sous-agent)
 *    n'est donc reconstructible QUE depuis le store, jamais depuis le flux.
 *
 *  - Le STORE (`SessionStore.listSubkeys()`/`load()`, ou les fonctions natives
 *    `listSubagents()`/`getSubagentMessages()`) est la source de COMPLÉTUDE :
 *    l'identité canonique d'un sous-agent est son `agentId` (nom du sous-chemin
 *    `subagents/agent-<agentId>`), garanti par le disque (H.3.1), jamais
 *    best-effort.
 *
 * ☠ Ces deux espaces d'identité (le `toolUseId` de l'appel `Agent` côté flux,
 * l'`agentId` côté store) ne sont PAS mécaniquement corrélables avec les types
 * publics du SDK 0.3.217 (aucun champ commun exposé dans les deux). Ce module
 * ne invente PAS de corrélation heuristique fragile : il expose les deux
 * vues, avec un écart CHIFFRÉ et explicite (`RapportCompletude`), jamais lissé
 * en silence — exactement l'exigence de H-72.3.
 */

import type { SessionMessage } from '@anthropic-ai/claude-agent-sdk';

// ---------------------------------------------------------------------------
// E.2.1 — trois granularités
// ---------------------------------------------------------------------------

export type Granularite = 'tokens' | 'activite_sous_agent' | 'resume';

export type StatutLigne = 'active' | 'terminee' | 'echouee';

/**
 * Une ligne de travail du fil temps réel (flux), identifiée par le
 * `parent_tool_use_id` de l'appel d'outil `Agent` qui l'a engendrée.
 * `id === RACINE_FLUX` pour le fil principal du lead.
 */
export interface LigneTravailFlux {
  readonly id: string;
  /** `null` pour la racine — sinon l'id de la ligne qui a dispatché celle-ci. */
  readonly parentId: string | null;
  readonly profondeur: 0 | 1;
  readonly sousAgentType: string | null;
  readonly description: string | null;
  readonly statut: StatutLigne;
  readonly dernierResume: string | null;
  readonly dernierOutil: string | null;
  readonly texteAccumule: string;
  readonly dispatcheeA: number;
  readonly majA: number;
}

/** Racine du fil principal — jamais un sous-agent. */
export const RACINE_FLUX = 'principal';

// ---------------------------------------------------------------------------
// Complétude flux ⟷ store (H-72.3) — jamais lissée
// ---------------------------------------------------------------------------

export interface RapportCompletude {
  readonly sousAgentsDispatches: number;
  readonly sousAgentsAvecContenuFlux: number;
  readonly sousAgentsConnusStore: number | null;
  /** `null` = store non interrogé (ex. absent), à distinguer de `0`. */
  readonly divergenceDetectee: boolean;
  readonly sousAgentsSansDetailTempsReel: number;
}

// ---------------------------------------------------------------------------
// Arbre profond (H.3, sur clic — E.2.2, ne réimplémente pas listSubagents/getSubagentMessages)
// ---------------------------------------------------------------------------

export interface NoeudAgentProfond {
  readonly agentId: string;
  readonly parentAgentId: string | null;
  readonly messages: readonly SessionMessage[];
  readonly enfants: readonly NoeudAgentProfond[];
}

/** Port minimal — jamais le contrat `SessionStore` complet (scope_guard). */
export interface LecteurSousAgents {
  listerSousAgents(sessionId: string): Promise<readonly string[]>;
  chargerMessagesAgent(sessionId: string, agentId: string): Promise<readonly SessionMessage[]>;
}

// ---------------------------------------------------------------------------
// C.4.2 — permissions dans le fil, requires_action visuellement distinct
// ---------------------------------------------------------------------------

export type NatureEvenementFil = 'activite' | 'permission';

export interface EvenementActiviteFil {
  readonly nature: 'activite';
  readonly ligneId: string;
  readonly granularite: Granularite;
  readonly texte: string | null;
  readonly horodatage: number;
  /** Toujours `false` — distinct des permissions (b). */
  readonly estRequiresAction: false;
}

export interface EvenementPermissionFil {
  readonly nature: 'permission';
  readonly ligneId: string;
  readonly toolUseId: string;
  readonly outil: string;
  readonly verdict: 'autorise' | 'refuse' | 'indetermine';
  readonly auteur: string;
  readonly horodatage: number;
  /**
   * (b) — `true` uniquement pour une demande réellement escaladée à l'humain
   * (bus-permissions, état `en_attente`) : c'est le SEUL signal qui doit
   * attirer l'œil (H-40/H-64 — le lead arbitre le reste en silence dans le fil).
   */
  readonly estRequiresAction: boolean;
}

export type EvenementFilMission = EvenementActiviteFil | EvenementPermissionFil;

// ---------------------------------------------------------------------------
// E.2.3 — diffusion, reprise au high-water mark, mode miroir
// ---------------------------------------------------------------------------

export interface EvenementDiffuse {
  readonly seq: number;
  readonly equipeId: string;
  readonly evenement: EvenementFilMission;
}

export type ModeAbonnement = 'pilote' | 'miroir';

/**
 * Poignée d'abonnement — volontairement dépourvue de toute méthode mutative
 * (pas d'`envoyerMessage`, pas d'`interrupt`) : ce module est un OBSERVATEUR
 * externe en lecture seule (H-72.1), jamais un canal de pilotage. Le mode
 * miroir n'a donc rien à brider de plus : l'absence de toute action est
 * structurelle, pas un drapeau vérifié au cas par cas.
 */
export interface AbonnementObservation {
  readonly mode: ModeAbonnement;
  readonly hautDeSeqInitial: number;
  fermer(): void;
}

/** Résumé léger d'une équipe — vue « liste », jamais le détail complet (e). */
export interface ResumeEquipeObservee {
  readonly equipeId: string;
  readonly etat: 'idle' | 'running' | 'requires_action';
  readonly dernierResume: string | null;
  readonly majA: number;
}
