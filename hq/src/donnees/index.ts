// Responsabilité : la surface publique du dossier donnees — ce que le monde (Phaser) et l'interface importent.
export type * from './contrat';
export { dureeLisible, etatAgent, SEUIL_INACTIVITE_MS, type EtatAgent, type SessionAgent } from './etat-agent';
export { MagasinMonde, TAILLES_PAR_DEFAUT, type EtatMonde, type Selecteur, type TaillesMagasin } from './monde-etat';
export { projetsDuMonde, sessionParId, sessionsActives, type ProjetVue } from './monde-selecteurs';
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
