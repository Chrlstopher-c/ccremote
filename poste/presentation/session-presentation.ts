// Responsabilité : la présentation d'une session SDK — son serveur d'outils `lanterne`, les images de ses messages et
// les pièces jointes de Chris. Une seule porte pour la session : elle ne touche ni à la requête ni au fil.
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type { McpSdkServerConfigWithInstance } from '@anthropic-ai/claude-agent-sdk';
import type { PieceJointe } from '../../commun/presentation.ts';
import { imagesDeMessage, presenterImages } from './images.ts';
import { cheminsImagesDuResultat } from './images-chemin.ts';
import { type PiecesPreparees, preparerPieces } from './pieces.ts';
import type { ContexteOutils } from './outils.ts';
import { serveurPresentation } from './serveur.ts';
import { type StockerImage, stockeurImages } from '../session/historique.ts';

export class PresentationSession {
  private readonly stocker: StockerImage;

  constructor(private readonly c: ContexteOutils) {
    this.stocker = stockeurImages(c.stockage, c.sessionId, c.journal);
  }

  serveur(): McpSdkServerConfigWithInstance {
    return serveurPresentation(this.c);
  }

  /** Images d'un message du SDK (résultat d'outil, lecture d'une image) : stockées et présentées dans le fil. */
  depuisMessage(msg: SDKMessage): void {
    if (msg.type !== 'user') return;
    const agent = msg.parent_tool_use_id ?? undefined;
    const images = imagesDeMessage(msg);
    if (images.length > 0) presenterImages(this.c, images, 'outil', agent);
    this.presenterChemins(msg.message.content, images.length, agent);
  }

  // Capture désignée par son chemin dans un résultat d'outil : lue par le lecteur borné, stockée par contenu (une
  // même image reçue deux fois garde son fichier), émise comme les images base64. Rangs à la suite des images.
  private presenterChemins(contenu: unknown, rangDepart: number, agent: string | undefined): void {
    const lire = this.c.lireChemin;
    if (!lire) return;
    cheminsImagesDuResultat(contenu).forEach((chemin, i) => {
      const image = lire(chemin);
      const evt = image ? this.stocker(image, rangDepart + i, 'outil') : null;
      if (evt?.type === 'image') this.c.emettre(agent ? { ...evt, agent } : evt);
    });
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
