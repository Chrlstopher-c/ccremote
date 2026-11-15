// Responsabilité : la surface publique du dossier donnees — ce que le monde (Phaser) et l'interface importent.
export type * from './contrat';
export { dureeLisible, etatAgent, SEUIL_INACTIVITE_MS, type EtatAgent, type SessionAgent } from './etat-agent';
export { MagasinMonde, TAILLES_PAR_DEFAUT, type EtatMonde, type Selecteur, type TaillesMagasin } from './monde-etat';
export { projetsDuMonde, reunionsTriees, sessionParId, sessionsActives, type ProjetVue } from './monde-selecteurs';
export {
  AUTEUR_CHRIS,
  ClientReunions,
  creerReunionsDemo,
  type ApiReunions,
  type DemandeReunion,
  type EnvoiReunion,
  type ReponseReunion,
} from './reunion';
export { creerActions, type ActionsMonde, type ResultatAction } from './actions';
export {
  CLE_JETON,
  lireConfig,
  stockageNavigateur,
  type ConfigMonde,
  type EnvSource,
  type StockageJeton,
} from './config';
export { creerSourceMonde, demarrerMonde } from './demarrage-monde';
export { creerSourceDemo } from './demo';
export { ErreurRelais } from './transport-http';
export { creerSourceRelais, type OptionsRelais } from './transport';
export type { ApiMonde, EcouteurSource, EtatLien, NomSource, SourceMonde } from './source-monde';
export {
  type BilanTerminal,
  type FabriqueTerminal,
  type OptionsOuverture,
  type SessionTerminal,
} from './terminal';
export { fabriqueTerminalDemo } from './terminal-demo';
export { creerFichiersRelais, TAILLE_MAX_EDITION, type ServiceFichiers } from './fichiers';
export { creerFichiersDemo } from './fichiers-demo';
export {
  fileEvenements,
  indexerBibliotheque,
  type Bibliotheque,
  type GenreRessource,
  type GenreTouche,
  type Ressource,
  type Touche,
} from './bibliotheque';
