// Responsabilité : le contrat des outils du parc ouverts aux sessions hors de Lanterne (machines, sessions, fil, envoi,
// ouverture, réponse, réveil) — opérations relayées par le lien poste ↔ relais, arguments validés des deux côtés et
// sorties lues par le serveur MCP `parc`.
import { z } from 'zod';
import { Evenement, ResumeSession } from './session.ts';

export const OPERATIONS_PARC = [
  'parc_machines',
  'parc_reveiller',
  'parc_sessions',
  'parc_fil',
  'parc_envoyer',
  'parc_ouvrir',
  'parc_repondre',
] as const;
export const QuoiParc = z.enum(OPERATIONS_PARC);
export type OperationParc = z.infer<typeof QuoiParc>;

export const REGEX_ID_MACHINE_PARC = /^[a-z0-9-]{1,60}$/;
export const TAILLE_MAX_ENVOI_PARC = 20_000; // caractères : un message envoyé à une session, ou une ouverture
export const LIMITE_FIL_PARC = 300; // événements au plus rendus par parc_fil
export const LIMITE_FIL_DEFAUT_PARC = 120;
export const STATUTS_VIVANTS_PARC = ['demarrage', 'travail', 'compaction', 'attente', 'question'] as const;

const Machine = z
  .string()
  .regex(REGEX_ID_MACHINE_PARC)
  .describe('identifiant de machine, tel que listé par parc_machines : tour, portable, pi…');
const Session = z.string().min(1).max(200).describe('identifiant de session, tel que listé par parc_sessions');

export const SCHEMA_PARC_MACHINES = {};
export const SCHEMA_PARC_REVEILLER = { machine: Machine };
export const SCHEMA_PARC_SESSIONS = {
  machine: Machine.optional().describe('ne lister que les sessions de cette machine'),
  toutes: z.boolean().optional().describe('inclure les sessions fermées (par défaut : les vivantes seulement)'),
};
export const SCHEMA_PARC_FIL = {
  session: Session,
  limite: z
    .number()
    .int()
    .min(1)
    .max(LIMITE_FIL_PARC)
    .optional()
    .describe(`événements à lire, ${LIMITE_FIL_DEFAUT_PARC} par défaut`),
};
export const SCHEMA_PARC_ENVOYER = {
  session: Session,
  texte: z.string().min(1).max(TAILLE_MAX_ENVOI_PARC),
};
export const SCHEMA_PARC_OUVRIR = {
  machine: Machine,
  dossier: z
    .string()
    .regex(/^\/[^\0]*$/)
    .max(1000)
    .describe('chemin absolu du dossier sur la machine, par exemple /mnt/projects/mon-projet'),
  message: z.string().min(1).max(TAILLE_MAX_ENVOI_PARC).describe('premier message : la tâche complète'),
  titre: z.string().max(120).optional(),
};
export const SCHEMA_PARC_REPONDRE = {
  session: Session,
  dialogue: z.string().min(1).max(200).describe('identifiant du dialogue en attente (parc_sessions, parc_fil)'),
  index: z.number().int().min(0).optional().describe('option choisie, à partir de 0'),
  texte: z.string().max(TAILLE_MAX_ENVOI_PARC).optional().describe('réponse libre'),
};

export const ArgsParcMachines = z.object(SCHEMA_PARC_MACHINES);
export const ArgsParcReveiller = z.object(SCHEMA_PARC_REVEILLER);
export const ArgsParcSessions = z.object(SCHEMA_PARC_SESSIONS);
export const ArgsParcFil = z.object(SCHEMA_PARC_FIL);
export const ArgsParcEnvoyer = z.object(SCHEMA_PARC_ENVOYER);
export const ArgsParcOuvrir = z.object(SCHEMA_PARC_OUVRIR);
export const ArgsParcRepondre = z
  .object(SCHEMA_PARC_REPONDRE)
  .refine((a) => a.index !== undefined || a.texte !== undefined, 'une option (index) ou une réponse libre (texte)');

export type ArgsParcFil = z.infer<typeof ArgsParcFil>;
export type ArgsParcEnvoyer = z.infer<typeof ArgsParcEnvoyer>;
export type ArgsParcOuvrir = z.infer<typeof ArgsParcOuvrir>;
export type ArgsParcRepondre = z.infer<typeof ArgsParcRepondre>;

// Sorties rendues par le relais (`donnees` de la réponse) : le serveur MCP les relit avant de les mettre en texte.
export const MachineParc = z.object({
  id: z.string(),
  description: z.string(),
  enLigne: z.boolean(),
  reveilPossible: z.boolean(),
});
export type MachineParc = z.infer<typeof MachineParc>;

export const SessionParc = z.object({
  id: z.string(),
  machine: z.string(),
  titre: z.string(),
  projet: z.string(),
  statut: z.string(),
  majLe: z.string(),
  terminal: z.boolean(),
  dialogue: z.object({ id: z.string(), titre: z.string() }).nullable(),
});
export type SessionParc = z.infer<typeof SessionParc>;

export const SortieMachinesParc = z.object({ machines: z.array(MachineParc) });
export const SortieSessionsParc = z.object({ sessions: z.array(SessionParc) });
export const SortieFilParc = z.array(z.object({ seq: z.number(), ts: z.string(), evt: Evenement }));
export const SortieOuvertureParc = ResumeSession.pick({ id: true, machine: true });
export const SortieReveilParc = z.object({ ok: z.boolean(), par: z.string().optional() });
