// Responsabilité : les pièces jointes de Chris — images et PDF envoyés au modèle avec son message ; tout autre fichier
// déposé dans le stockage de la session, avec son chemin donné au modèle dans le texte. Tout est vérifié avant d'écrire.
import type { Evenement } from '../../commun/session.ts';
import { nomAffiche, PieceJointe, TAILLE_MAX_PIECE, typeDeFichier } from '../../commun/presentation.ts';
import { estTypeImage, type TypeImage } from './images.ts';
import { join } from 'node:path';
import type { ContexteOutils } from './outils.ts';

export type BlocPiece =
  | {
      readonly type: 'image';
      readonly source: { readonly type: 'base64'; readonly media_type: TypeImage; readonly data: string };
    }
  | {
      readonly type: 'document';
      readonly source: { readonly type: 'base64'; readonly media_type: 'application/pdf'; readonly data: string };
    };

export interface PiecesPreparees {
  readonly blocs: readonly BlocPiece[];
  readonly complement: string;
  readonly evenements: readonly Evenement[]; // à émettre après le message de Chris, pour que le fil l'ordonne
}

interface PieceVerifiee {
  readonly piece: PieceJointe;
  readonly mime: string;
  readonly octets: Buffer;
}

function verifier(piece: PieceJointe): PieceVerifiee {
  const mime = typeDeFichier(piece.nom);
  if (!mime) throw new Error(`pièce refusée (type non pris en charge) : ${nomAffiche(piece.nom)}`);
  const octets = Buffer.from(piece.base64, 'base64');
  if (octets.length === 0 || octets.length > TAILLE_MAX_PIECE) {
    throw new Error(`pièce refusée (taille) : ${nomAffiche(piece.nom)}, 3 Mo au plus`);
  }
  return { piece, mime, octets };
}

export function preparerPieces(c: ContexteOutils, pieces: readonly PieceJointe[]): PiecesPreparees {
  const verifiees = pieces.map(verifier);
  const blocs: BlocPiece[] = [];
  const lignes: string[] = [];
  const evenements: Evenement[] = [];
  for (const { piece, mime, octets } of verifiees) {
    const nom = nomAffiche(piece.nom);
    const id = c.stockage.nouvelId();
    c.stockage.ecrire(c.sessionId, id, octets, { nom, mime, taille: octets.length });
    if (estTypeImage(mime)) {
      blocs.push({ type: 'image', source: { type: 'base64', media_type: mime, data: piece.base64 } });
      evenements.push({ type: 'image', fichier: id, nom, mime, taille: octets.length, origine: 'utilisateur' });
    } else if (mime === 'application/pdf') {
      blocs.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: piece.base64 } });
      evenements.push({
        type: 'fichier',
        fichier: id,
        nom,
        mime,
        taille: octets.length,
        mode: 'afficher',
        legende: null,
      });
    } else {
      lignes.push(`- ${nom} : ${join(c.stockage.dossier(c.sessionId), id)}`);
      evenements.push({
        type: 'fichier',
        fichier: id,
        nom,
        mime,
        taille: octets.length,
        mode: 'joindre',
        legende: null,
      });
    }
  }
  const complement =
    lignes.length > 0 ? `\n\nFichiers joints par l’utilisateur (sur le poste) :\n${lignes.join('\n')}` : '';
  return { blocs, complement, evenements };
}
