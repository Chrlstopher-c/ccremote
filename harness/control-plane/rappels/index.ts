/**
 * Interface publique du domaine « rappels » — la seule chose qui permette à
 * l'orchestrateur d'agir sur le TEMPS.
 *
 * Aucun autre module ne doit importer les fichiers internes de ce dossier.
 */

export { ServiceRappels, composerTexteRappel } from './service-rappels.ts';
export type { EtatCarburant, PortReveilFil } from './service-rappels.ts';
export {
  PERIODE_MIN_MS,
  PERIODE_MAX_MS,
  PREMIER_TIR_MIN_MS,
  RAPPELS_ACTIFS_MAX,
  REPORT_MS,
  SEUIL_REPORT_PCT,
  peutTirer,
  validerRappel,
} from './politique-rappels.ts';
export type { DemandeRappel, VerdictRappel, VerdictTir } from './politique-rappels.ts';
