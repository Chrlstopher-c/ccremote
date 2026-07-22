/**
 * Responsabilité : transformer le flux SDK d'UNE session orchestrateur en
 * événements persistés, bloc par bloc. C'est ce qui rend le streaming possible
 * côté UI : chaque bloc (réflexion, texte, outil) devient un événement dès qu'il
 * arrive, l'UI le voit au prochain sondage — au lieu d'attendre la réponse
 * entière d'un coup.
 *
 * `☠` Ne lève JAMAIS : ce collecteur est appelé depuis la boucle de lecture
 * unique de `query` (voir `gestionnaire-conversations.ts`). Une exception ici
 * tuerait la boucle et figerait la session. Toute erreur d'écriture est
 * journalisée, jamais propagée.
 *
 * `☠` `#genere` (un tour est en cours de génération) est la seule vérité de
 * l'état « l'orchestrateur est en train de répondre ». Passé à `true` à l'envoi
 * de l'opérateur, remis à `false` sur le `result` du tour. L'UI l'interroge pour
 * savoir s'il faut continuer à sonder.
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

/** Extrait les blocs typés d'un message assistant, dans l'ordre. */
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

export class CollecteurConversation {
  #genere = false;

  constructor(
    private readonly conversationId: string,
    private readonly depot: DepotConversations,
  ) {}

  /** L'opérateur vient d'envoyer : un tour de génération commence. */
  marquerEnvoi(): void {
    this.#genere = true;
  }

  get genere(): boolean {
    return this.#genere;
  }

  /**
   * Poussé par la boucle de lecture unique, pour CHAQUE message. Persiste les
   * blocs et met à jour l'état de génération. Ne lève jamais.
   */
  ingerer(message: SDKMessage): void {
    try {
      for (const bloc of blocsAssistant(message)) {
        this.depot.ajouterEvenement({ conversationId: this.conversationId, type: bloc.type, contenu: bloc.contenu });
      }
      if (message.type === 'result') {
        this.#genere = false;
        const subtype = (message as { subtype?: string }).subtype;
        if (subtype !== undefined && subtype !== 'success') {
          this.depot.ajouterEvenement({
            conversationId: this.conversationId,
            type: 'erreur',
            contenu: `Le tour s'est terminé sur une erreur (${subtype}).`,
          });
        } else {
          this.depot.ajouterEvenement({ conversationId: this.conversationId, type: 'resultat', contenu: '' });
        }
      }
    } catch (erreur) {
      log.error({ err: erreur, conversationId: this.conversationId }, 'échec de persistance d’un événement — boucle préservée');
    }
  }

  /** La boucle de lecture s'est arrêtée sur une erreur : figer proprement. */
  marquerErreur(raison: string): void {
    this.#genere = false;
    try {
      this.depot.ajouterEvenement({ conversationId: this.conversationId, type: 'erreur', contenu: raison });
    } catch (erreur) {
      log.error({ err: erreur, conversationId: this.conversationId }, 'échec de persistance de l’erreur terminale');
    }
  }
}
