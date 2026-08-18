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

/** Écriture d'artefact — même racine, même route de lecture, pipeline distinct (voir `artefacts.ts`). */
export {
  ecrireArtefact,
  ErreurArtefact,
  MAX_OCTETS_ARTEFACT,
  typesArtefactAcceptes,
  type ArtefactEcrit,
} from './artefacts.ts';
