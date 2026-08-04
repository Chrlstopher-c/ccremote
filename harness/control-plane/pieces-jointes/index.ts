/** Interface publique du domaine « pièces jointes ». Rien d'autre ne doit être importé de l'extérieur. */
export {
  assainirNom,
  cheminPieceRelue,
  decrirePiecesPourModele,
  dossierConversation,
  ecrirePieces,
  ErreurPieceJointe,
  MAX_OCTETS_PAR_MESSAGE,
  MAX_OCTETS_PAR_PIECE,
  MAX_PIECES_PAR_MESSAGE,
  typesAcceptes,
  validerPieces,
  type PieceJointeEnregistree,
  type PieceJointeEntrante,
  type PieceJointeValidee,
} from './pieces-jointes.ts';
