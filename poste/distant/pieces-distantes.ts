// Responsabilité : stocker sur le poste les pièces (images, documents) des messages d'une session claude.ai, pour que
// le fil les présente comme dans une session du poste. Identifiant tiré du contenu : une relecture ne double rien.
import type { Logger } from 'pino';
import type { Evenement } from '../../commun/session.ts';
import { TAILLE_MAX_FICHIER } from '../../commun/presentation.ts';
import { identifiantImage, stockeurImages } from '../session/historique.ts';
import type { Stockage } from '../presentation/stockage.ts';
import type { PieceBrute, StockeurPieces } from './traduction-distante.ts';

const EXTENSIONS: Record<string, string> = { 'application/pdf': 'pdf', 'text/plain': 'txt' };

export function stockeurPieces(stockage: Stockage, sessionId: string, journal: Logger): StockeurPieces {
  const images = stockeurImages(stockage, sessionId, journal);
  return {
    image: (piece, rang, origine) => images(piece, rang, origine),
    document: (piece, rang, nom) => stockerDocument(stockage, sessionId, journal, piece, nom ?? nomPar(piece, rang)),
  };
}

function nomPar(piece: PieceBrute, rang: number): string {
  return `document-${rang + 1}.${EXTENSIONS[piece.mime] ?? 'bin'}`;
}

function stockerDocument(
  stockage: Stockage,
  sessionId: string,
  journal: Logger,
  piece: PieceBrute,
  nom: string,
): Evenement | null {
  try {
    const octets = Buffer.from(piece.base64, 'base64');
    if (octets.length > TAILLE_MAX_FICHIER) {
      journal.warn({ session: sessionId, taille: octets.length }, 'document trop lourd pour le fil, écarté');
      return null;
    }
    const fichier = identifiantImage(octets);
    if (!stockage.existe(sessionId, fichier)) {
      stockage.ecrire(sessionId, fichier, octets, { nom, mime: piece.mime, taille: octets.length });
    }
    return { type: 'fichier', fichier, nom, mime: piece.mime, taille: octets.length, mode: 'joindre', legende: null };
  } catch (erreur) {
    journal.error({ err: erreur, session: sessionId }, 'document d’une session claude.ai impossible à stocker');
    return null;
  }
}
