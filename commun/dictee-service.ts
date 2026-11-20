// Responsabilité : le contrat du service de dictée piloté depuis le relais — état de chaque poste (script moteur,
// latence, inactivité, moteur lancé par ce poste), réglage de l'arrêt automatique, action démarrer/arrêter/régler.
import { z } from 'zod';

export const ETATS_MOTEUR_DICTEE = ['absent', 'arrete', 'demarrage', 'pret', 'erreur'] as const;
export const ARRET_INACTIVITE_DEFAUT_MIN = 15;
/** Délai accordé à un poste pour une action (démarrer, arrêter, régler) : le chargement se fait en fond. */
export const DELAI_SERVICE_DICTEE_MS = 20_000;
const ArretInactivite = z.number().int().min(0).max(1440);

export const EtatServiceDicteePoste = z.object({
  installe: z.boolean(),
  etat: z.enum(ETATS_MOTEUR_DICTEE),
  depuis: z.string().nullable(), // ISO, démarrage du moteur (script)
  chargementMs: z.number().nullable(), // durée de chargement du modèle (script)
  memoireGpuMo: z.number().nullable(), // (script)
  latenceMs: z.number().nullable(), // ms de la dernière transcription servie par ce poste (mémoire du poste)
  derniereActivite: z.string().nullable(), // ISO : dernier démarrage ou dernière transcription
  arretInactiviteMin: ArretInactivite, // 0 = jamais
  lanceParPoste: z.boolean(), // pid du moteur == pid lancé par ce poste
  message: z.string().nullable(),
});
export type EtatServiceDicteePoste = z.infer<typeof EtatServiceDicteePoste>;

export const ServiceDicteeMachine = EtatServiceDicteePoste.extend({ machine: z.string() });
export type ServiceDicteeMachine = z.infer<typeof ServiceDicteeMachine>;

export const ServiceDictee = z.object({ machines: z.array(ServiceDicteeMachine) });
export type ServiceDictee = z.infer<typeof ServiceDictee>;

export const CorpsServiceDictee = z.object({
  action: z.enum(['demarrer', 'arreter', 'regler']),
  arretInactiviteMin: ArretInactivite.optional(),
});
export type CorpsServiceDictee = z.infer<typeof CorpsServiceDictee>;
export type ActionServiceDictee = CorpsServiceDictee['action'];
