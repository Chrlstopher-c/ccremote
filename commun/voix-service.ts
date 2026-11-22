// Responsabilité : le contrat du service de voix piloté depuis le relais — état de chaque poste (unité systemd
// utilisateur lanterne-voix : installée, prête, en chargement, arrêtée, en erreur) et action démarrer/arrêter.
import { z } from 'zod';

export const ETATS_SERVICE_VOIX = ['absent', 'arrete', 'demarrage', 'pret', 'erreur'] as const;
/** Délai accordé à un poste pour une action (démarrer, arrêter) : le modèle se charge en fond, l'action rend vite. */
export const DELAI_SERVICE_VOIX_MS = 20_000;

export const EtatServiceVoixPoste = z.object({
  installe: z.boolean(),
  etat: z.enum(ETATS_SERVICE_VOIX),
  depuis: z.string().nullable(), // ISO : entrée en marche du service
  message: z.string().nullable(),
});
export type EtatServiceVoixPoste = z.infer<typeof EtatServiceVoixPoste>;

export const ServiceVoixMachine = EtatServiceVoixPoste.extend({ machine: z.string() });
export type ServiceVoixMachine = z.infer<typeof ServiceVoixMachine>;

export const ServiceVoix = z.object({ machines: z.array(ServiceVoixMachine) });
export type ServiceVoix = z.infer<typeof ServiceVoix>;

export const CorpsServiceVoix = z.object({ action: z.enum(['demarrer', 'arreter']) });
export type CorpsServiceVoix = z.infer<typeof CorpsServiceVoix>;
export type ActionServiceVoix = CorpsServiceVoix['action'];
