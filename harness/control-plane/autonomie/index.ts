/**
 * Interface publique du domaine « autonomie » — qui autorise un mandat, et sous
 * quelles bornes.
 *
 * Aucun autre module ne doit importer les fichiers internes de ce dossier.
 */

export { AUTO_APPROBATIONS_MAX, deciderAutorisation, fenetreOuverte } from './decision-autorisation.ts';
export type { ContexteAutorisation, DecisionAutorisation, ModeAutorisation } from './decision-autorisation.ts';
