/**
 * Responsabilité : transformer le flux SDK d'UNE session orchestrateur en
 * événements affichables, avec un VRAI streaming token par token.
 *
 * `☠ LA CLÉ` — la session est composée avec `includePartialMessages: true` : le
 * SDK émet des `stream_event` (deltas de texte et de réflexion) AVANT le message
 * `assistant` complet. Une première version ne lisait que le message complet et
 * jetait tous les deltas : la réponse « tombait » d'un bloc à l'écran. Le
 * streaming ne se règle pas côté interface, il se lit ICI.
 *
 * `☠` Deux régimes, jamais les deux à la fois (sinon chaque bloc serait persisté
 * en double) : si un `stream_event` a été vu pendant le tour, les blocs sont
 * persistés à leur `content_block_stop` et le message `assistant` complet est
 * IGNORÉ ; sinon (SDK sans partiels) on retombe sur le message complet. Le
 * drapeau `#streameCeTour` porte ce choix.
 *
 * `☠` La persistance se fait au BLOC TERMINÉ, jamais au token : un INSERT par
 * token noierait SQLite. Le bloc en cours vit en mémoire (`#partiel`) et est
 * servi tel quel à l'interface, qui le voit grandir à chaque sondage.
 *
 * `☠` Ne lève JAMAIS : appelé depuis la boucle de lecture unique de la session.
 * Une exception ici tuerait la boucle et figerait la conversation.
 */

import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type { DepotConversations } from '../registre/index.ts';
import type { TypeEvenementConversation } from '../registre/index.ts';
import { processusOrchestrateurLogger } from './processus/logger.ts';

const log = processusOrchestrateurLogger.child({ composant: 'collecteur-conversation' });

interface BlocContenu {
  readonly type?: string;
  readonly text?: string;
  readonly thinking?: string;
  readonly name?: string;
}

/** Bloc en cours de construction, servi à l'interface avant d'être persisté. */
export interface BlocPartiel {
  readonly type: TypeEvenementConversation;
  readonly contenu: string;
}

/**
 * Sonde de `stream_event`. `event` est un type profond de l'API Beta
 * (`BetaRawMessageStreamEvent`) : on sonde une forme large, jamais castée
 * précisément — même convention que `observabilite/arbre-flux.ts`.
 */
interface SondeStream {
  readonly event?: {
    readonly type?: string;
    readonly content_block?: { readonly type?: string; readonly name?: string };
    readonly delta?: { readonly type?: string; readonly text?: string; readonly thinking?: string };
  };
}

/** Extrait les blocs typés d'un message assistant COMPLET (régime sans partiels). */
function blocsAssistant(message: SDKMessage): { type: TypeEvenementConversation; contenu: string }[] {
  if (message.type !== 'assistant') return [];
  const contenu = (message as { message?: { content?: unknown } }).message?.content;
  if (typeof contenu === 'string') {
    return contenu.trim().length > 0 ? [{ type: 'texte', contenu }] : [];
  }
  if (!Array.isArray(contenu)) return [];
  const sortie: { type: TypeEvenementConversation; contenu: string }[] = [];
  for (const brut of contenu as BlocContenu[]) {
    if (brut.type === 'text' && typeof brut.text === 'string' && brut.text.length > 0) {
      sortie.push({ type: 'texte', contenu: brut.text });
    } else if (brut.type === 'thinking' && typeof brut.thinking === 'string' && brut.thinking.length > 0) {
      sortie.push({ type: 'reflexion', contenu: brut.thinking });
    } else if (brut.type === 'redacted_thinking') {
      sortie.push({ type: 'reflexion', contenu: '[réflexion masquée par le modèle]' });
    } else if (brut.type === 'tool_use' && typeof brut.name === 'string') {
      sortie.push({ type: 'outil', contenu: brut.name });
    }
  }
  return sortie;
}

/** Traduit le type de bloc SDK vers notre vocabulaire d'événement. */
function typeDepuisBloc(typeBloc: string | undefined): TypeEvenementConversation | null {
  if (typeBloc === 'text') return 'texte';
  if (typeBloc === 'thinking' || typeBloc === 'redacted_thinking') return 'reflexion';
  if (typeBloc === 'tool_use') return 'outil';
  return null;
}

export class CollecteurConversation {
  #genere = false;
  #streameCeTour = false;
  #partiel: { type: TypeEvenementConversation; contenu: string } | null = null;

  constructor(
    private readonly conversationId: string,
    private readonly depot: DepotConversations,
  ) {}

  /** L'opérateur vient d'envoyer : un tour de génération commence. */
  marquerEnvoi(): void {
    this.#genere = true;
    this.#streameCeTour = false;
    this.#partiel = null;
  }

  get genere(): boolean {
    return this.#genere;
  }

  /** Le bloc en cours de frappe, ou `null`. Lu par l'API à chaque sondage. */
  get partiel(): BlocPartiel | null {
    return this.#partiel;
  }

  /**
   * Poussé par la boucle de lecture unique, pour CHAQUE message. Ne lève jamais.
   */
  ingerer(message: SDKMessage): void {
    try {
      if (message.type === 'stream_event') {
        this.#ingererPartiel(message);
        return;
      }
      if (message.type === 'assistant') {
        // `☠` Déjà persisté bloc par bloc pendant le streaming : ne pas doubler.
        if (this.#streameCeTour) return;
        for (const bloc of blocsAssistant(message)) this.#persister(bloc.type, bloc.contenu);
        return;
      }
      if (message.type === 'result') this.#terminerTour(message);
    } catch (erreur) {
      log.error({ err: erreur, conversationId: this.conversationId }, 'échec de traitement d’un message — boucle préservée');
    }
  }

  /** La boucle de lecture s'est arrêtée sur une erreur : figer proprement. */
  marquerErreur(raison: string): void {
    this.#genere = false;
    this.#partiel = null;
    try {
      this.depot.ajouterEvenement({ conversationId: this.conversationId, type: 'erreur', contenu: raison });
    } catch (erreur) {
      log.error({ err: erreur, conversationId: this.conversationId }, 'échec de persistance de l’erreur terminale');
    }
  }

  /** Deltas du SDK : début de bloc, tokens, fin de bloc. */
  #ingererPartiel(message: SDKMessage): void {
    const evenement = (message as unknown as SondeStream).event;
    if (evenement === undefined) return;
    this.#streameCeTour = true;

    if (evenement.type === 'content_block_start') {
      const type = typeDepuisBloc(evenement.content_block?.type);
      if (type === null) return;
      // Un `tool_use` n'a pas de delta de texte : son nom est connu dès le début
      // et se persiste immédiatement — c'est le « commentaire pendant la
      // génération » que l'opérateur voit défiler.
      if (type === 'outil') {
        const nom = evenement.content_block?.name;
        if (typeof nom === 'string' && nom.length > 0) this.#persister('outil', nom);
        return;
      }
      this.#partiel = { type, contenu: '' };
      return;
    }

    if (evenement.type === 'content_block_delta') {
      const delta = evenement.delta;
      const morceau = delta?.type === 'text_delta' ? delta.text : delta?.type === 'thinking_delta' ? delta.thinking : undefined;
      if (typeof morceau !== 'string' || morceau.length === 0) return;
      const type: TypeEvenementConversation = delta?.type === 'thinking_delta' ? 'reflexion' : 'texte';
      // Un delta sans `content_block_start` observé reste affichable : on ouvre
      // le bloc à la volée plutôt que de perdre du texte.
      if (this.#partiel === null || this.#partiel.type !== type) this.#partiel = { type, contenu: '' };
      this.#partiel = { type, contenu: this.#partiel.contenu + morceau };
      return;
    }

    if (evenement.type === 'content_block_stop') this.#finaliserPartiel();
  }

  #finaliserPartiel(): void {
    const partiel = this.#partiel;
    this.#partiel = null;
    if (partiel === null || partiel.contenu.trim().length === 0) return;
    this.#persister(partiel.type, partiel.contenu);
  }

  #terminerTour(message: SDKMessage): void {
    this.#finaliserPartiel();
    this.#genere = false;
    this.#streameCeTour = false;
    const subtype = (message as { subtype?: string }).subtype;
    if (subtype !== undefined && subtype !== 'success') {
      this.#persister('erreur', `Le tour s'est terminé sur une erreur (${subtype}).`);
      return;
    }
    this.#persister('resultat', '');
  }

  #persister(type: TypeEvenementConversation, contenu: string): void {
    try {
      this.depot.ajouterEvenement({ conversationId: this.conversationId, type, contenu });
    } catch (erreur) {
      log.error({ err: erreur, conversationId: this.conversationId, type }, 'échec de persistance d’un événement');
    }
  }
}
