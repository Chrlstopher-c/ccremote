/**
 * Interface publique du module « api-web » (contrat :
 * `pi-web/CONTRAT-API-HARNESS.md`). Aucun autre module ne doit importer les
 * fichiers internes de ce dossier.
 *
 * Périmètre : servir en LECTURE l'état du control plane à `pi-web`, derrière
 * lequel ce serveur vit toujours. Les écritures (ordres vers le PC) ne sont pas
 * ici — voir l'en-tête de `serveur-api.ts` pour pourquoi.
 */

export { demarrerServeurApiWeb } from './serveur-api.ts';
export type { DependancesApiWeb, OptionsServeurApiWeb, ServeurApiWeb } from './serveur-api.ts';
export type { Enveloppe } from './enveloppe.ts';
export { ErreurApi } from './enveloppe.ts';
export type { MissionApi, EtatMissionApi } from './vue-missions.ts';
export type { EscaladeApi } from './vue-escalades.ts';
export type { AccountApi, FenetreApi } from './vue-comptes.ts';
