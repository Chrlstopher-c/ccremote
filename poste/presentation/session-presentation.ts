// Responsabilité : la présentation d'une session SDK — son serveur d'outils `lanterne`, les images de ses messages et
// les pièces jointes de Chris. Une seule porte pour la session : elle ne touche ni à la requête ni au fil.
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type { McpSdkServerConfigWithInstance } from '@anthropic-ai/claude-agent-sdk';
import type { PieceJointe } from '../../commun/presentation.ts';
import { imagesDeMessage, presenterImages } from './images.ts';
import { type PiecesPreparees, preparerPieces } from './pieces.ts';
import type { ContexteOutils } from './outils.ts';
import { serveurPresentation } from './serveur.ts';

export class PresentationSession {
  constructor(private readonly c: ContexteOutils) {}

  serveur(): McpSdkServerConfigWithInstance {
    return serveurPresentation(this.c);
  }

  /** Images d'un message du SDK (résultat d'outil, lecture d'une image) : stockées et présentées dans le fil. */
  depuisMessage(msg: SDKMessage): void {
    if (msg.type !== 'user') return;
    const images = imagesDeMessage(msg);
    if (images.length > 0) presenterImages(this.c, images, 'outil', msg.parent_tool_use_id ?? undefined);
  }

  /** Pièces jointes de Chris : vérifiées, stockées ; ce qui part au modèle, ou le motif du refus (rien n'est envoyé). */
  pieces(pieces: readonly PieceJointe[]): PiecesPreparees | string {
    try {
      return preparerPieces(this.c, pieces);
    } catch (erreur) {
      this.c.journal.warn({ err: erreur, session: this.c.sessionId }, 'pièce jointe refusée');
      return erreur instanceof Error ? erreur.message : String(erreur);
    }
  }
}
