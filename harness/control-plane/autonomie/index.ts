/**
 * Interface publique du domaine « autonomie » — qui autorise un mandat, et sous
 * quelles bornes.
 *
 * Aucun autre module ne doit importer les fichiers internes de ce dossier.
 */

export {
  AUTO_APPROBATIONS_MAX,
  deciderAutorisation,
  fenetreOuverte,
  seuilComptageAutonomie,
} from './decision-autorisation.ts';
export type { ContexteAutorisation, DecisionAutorisation, ModeAutorisation } from './decision-autorisation.ts';
export {
  decrirePlafond,
  ecrireReglagePlafond,
  ErreurPlafondInvalide,
  HERITE,
  JETON_ILLIMITE,
  lirePlafondAutonomieParc,
  lireReglagePlafond,
  normaliserReglagePlafond,
  plafondEffectif,
  type ReglagePlafond,
} from './reglage-plafond.ts';
