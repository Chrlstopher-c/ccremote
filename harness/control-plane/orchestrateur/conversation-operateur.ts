/**
 * Responsabilité : transformer la session orchestrateur (flux SDK à lecteur
 * unique) en un aller-retour question→réponse utilisable par l'API web.
 *
 * `☠` Le flux `query` n'a qu'UN lecteur légitime (le `for await` de `bin-pi`).
 * Cette classe ne lit donc JAMAIS le flux elle-même : le lecteur unique lui
 * pousse chaque message via `ingerer()`, en parallèle de `ingererMessage()`
 * (discipline de contexte). Un second `for await` volerait des messages au
 * premier — piège documenté sur `PoigneeOrchestrateur.query`.
 *
 * `☠` Un seul tour à la fois. L'orchestrateur est une conversation, pas un pool
 * de requêtes : deux messages opérateur simultanés mélangeraient leurs
 * réponses. Un envoi pendant qu'un tour est en cours est rejeté, jamais mis en
 * file en douce — l'opérateur doit savoir que le précédent n'a pas fini.
 */

import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { processusOrchestrateurLogger } from './processus/logger.ts';

const log = processusOrchestrateurLogger.child({ composant: 'conversation-operateur' });

/** Ce que la conversation a besoin de la poignée, et rien de plus. */
export interface EntreeConversation {
  envoyerOperateur(texte: string): Promise<void>;
}

export class ConversationEnCoursError extends Error {
  constructor() {
    super('un tour de conversation est déjà en cours — attends la réponse avant d’en envoyer un autre');
    this.name = 'ConversationEnCoursError';
  }
}

interface TourEnCours {
  readonly morceaux: string[];
  readonly resoudre: (reponse: string) => void;
  readonly rejeter: (erreur: Error) => void;
  readonly minuterie: ReturnType<typeof setTimeout>;
}

/** Extrait le texte d'un message assistant. Ignore le reste (outils, pensée). */
function texteAssistant(message: SDKMessage): string {
  if (message.type !== 'assistant') return '';
  const contenu = (message as { message?: { content?: unknown } }).message?.content;
  if (typeof contenu === 'string') return contenu;
  if (!Array.isArray(contenu)) return '';
  return contenu
    .filter((bloc): bloc is { type: 'text'; text: string } => (bloc as { type?: string }).type === 'text')
    .map((bloc) => bloc.text)
    .join('');
}

export class ConversationOperateur {
  #tour: TourEnCours | null = null;

  constructor(
    private readonly entree: EntreeConversation,
    private readonly timeoutMs = 120_000,
  ) {}

  /**
   * Envoie un message et résout avec la réponse complète de l'assistant (tout
   * le texte jusqu'au `result` du tour). Rejette si un tour est déjà en cours,
   * ou après `timeoutMs` sans `result` — jamais de promesse suspendue à vie.
   */
  async envoyer(texte: string): Promise<string> {
    if (texte.trim().length === 0) throw new RangeError('un message vide n’est jamais envoyé à l’orchestrateur');
    if (this.#tour !== null) throw new ConversationEnCoursError();

    const attente = new Promise<string>((resoudre, rejeter) => {
      const minuterie = setTimeout(() => {
        this.#tour = null;
        rejeter(new Error(`aucune réponse de l’orchestrateur en ${this.timeoutMs} ms`));
      }, this.timeoutMs);
      this.#tour = { morceaux: [], resoudre, rejeter, minuterie };
    });

    try {
      await this.entree.envoyerOperateur(texte);
    } catch (erreur) {
      this.#annulerTour();
      throw erreur instanceof Error ? erreur : new Error(String(erreur));
    }
    return attente;
  }

  /**
   * Poussé par le lecteur unique de `query`, pour CHAQUE message. Ne lève
   * jamais : une conversation qui plante ne doit pas tuer la boucle de lecture.
   */
  ingerer(message: SDKMessage): void {
    if (this.#tour === null) return; // aucun tour en attente : rien à collecter.
    try {
      const texte = texteAssistant(message);
      if (texte.length > 0) this.#tour.morceaux.push(texte);
      if (message.type === 'result') {
        const tour = this.#tour;
        this.#tour = null;
        clearTimeout(tour.minuterie);
        tour.resoudre(tour.morceaux.join('').trim());
      }
    } catch (erreur) {
      log.error({ err: erreur }, 'erreur en collectant un message de conversation — tour abandonné, boucle préservée');
      this.#annulerTour();
    }
  }

  #annulerTour(): void {
    if (this.#tour === null) return;
    const tour = this.#tour;
    this.#tour = null;
    clearTimeout(tour.minuterie);
    tour.rejeter(new Error('tour de conversation interrompu'));
  }
}
