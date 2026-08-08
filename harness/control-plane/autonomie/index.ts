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
  DUREE_FENETRE_MAX_MS,
  DUREE_FENETRE_MIN_MS,
  ErreurFenetreInvalide,
  ErreurInstantInvalide,
  instantLisible,
  natureFin,
  naturePlafond,
  normaliserInstant,
  validerFenetre,
  type Fenetre,
  type NatureChangement,
} from './fenetre-autonomie.ts';
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
