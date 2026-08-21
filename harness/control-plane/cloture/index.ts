/**
 * Interface publique du domaine « clôture » — ce qui empêche une équipe au repos
 * de verrouiller son projet indéfiniment (H-56).
 *
 * Aucun autre module ne doit importer les fichiers internes de ce dossier.
 */

export { ServiceCloture } from './service-cloture.ts';
export { DELAI_CLOTURE_IDLE_MS, MOTIF_CLOTURE_IDLE, missionsAClore } from './politique-cloture.ts';
export { detecterRaisonCoupure, RAISON_CLOTURE_SANS_RAPPORT, type RaisonCoupure } from './raison-terminale.ts';
