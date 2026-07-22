/**
 * Interface publique du module `anti-boucle` — le juge anti-boucle (H-68, mission
 * M-53). Aucun autre module ne doit importer les fichiers internes de ce dossier.
 *
 * ☠ Ce module n'est câblé nulle part par construction (mandat M-53) : il expose une
 * API pure + un port injectable + une implémentation réelle, et attend d'être branché
 * par le parent. Voir le rapport de mission pour le point de branchement recommandé.
 */

export { verifierPalier, tousPaliersInspectes } from './paliers.ts';
export { extraireSignaux } from './extraction-signaux.ts';
export { deciderCoupure, SEUIL_ESCALADE_INCERTAINS_PAR_DEFAUT } from './decision-coupure.ts';
export { creerJugeHaiku, MODELE_JUGE_PAR_DEFAUT } from './juge-haiku.ts';
export type { DependancesJugeHaiku } from './juge-haiku.ts';

export type {
  ActionCoupure,
  AntiBoucleQueryFn,
  ConfigPaliers,
  ContexteJugement,
  DeclenchementPalier,
  DecisionCoupure,
  EtatEscalade,
  EtatPaliers,
  FichierModifie,
  JugeBoucle,
  OutilAppele,
  OutilRepete,
  ResultatDecision,
  ResumeTour,
  SignauxBoucle,
  Verdict,
  VerdictJuge,
} from './types.ts';

export { ETAT_ESCALADE_INITIAL, ETAT_PALIERS_INITIAL, PALIERS_PAR_DEFAUT } from './types.ts';
