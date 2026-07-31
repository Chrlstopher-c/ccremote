/**
 * Interface publique du domaine « notifications » — le canal par lequel un fait
 * du parc atteint Chris et l'orchestrateur.
 *
 * Aucun autre module ne doit importer les fichiers internes de ce dossier.
 */

export { ServiceNotifications } from './service-notifications.ts';
export type { OptionsSignalement, PortRemiseOrchestrateur } from './service-notifications.ts';
export { redigerEchecEquipe, redigerFinEquipe, redigerPour } from './redaction.ts';
export type { TexteNotification } from './redaction.ts';
export { detecterFinDeTour } from './detecteur-fin-equipe.ts';
