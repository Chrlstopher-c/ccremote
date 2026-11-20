// Responsabilité : une session Claude Code trouvée sur un poste (transcript du dossier projects) mais pas encore
// ouverte dans Lanterne. Le relais les expose telles quelles ; ouvrir une session l'adopte (fiche + reprise SDK).
import { z } from 'zod';

export const Decouverte = z.object({
  id: z.string().regex(/^[A-Za-z0-9-]{1,100}$/),
  machine: z.string(),
  cwd: z.string(),
  titre: z.string(),
  modifieLe: z.string(),
  branche: z.string().nullable(),
  messages: z.number().int().nonnegative(),
  vivante: z.boolean().optional(), // un processus Claude tient cette conversation sur ce poste
  ponts: z.array(z.string()).optional(), // identifiants Remote Control (cse_…) de la conversation, dédoublonnés
  cwdExiste: z.boolean().optional(), // le dossier de la conversation existe sur ce poste (copie synchronisée sinon)
  hoteDesktop: z.string().optional(), // machine où Claude Desktop la fait tourner (sa fiche Desktop, locale ou ssh)
});
export type Decouverte = z.infer<typeof Decouverte>;

/** Fiche Claude Desktop d'un poste, annoncée au relais : archivage et Remote Control de la conversation. */
export const FicheDesktopAnnoncee = z.object({
  conversation: z.string(),
  archivee: z.boolean(),
  remoteControl: z.boolean(),
  hote: z.string().nullable(), // machine ssh où tourne la conversation ; null : ce poste
});
export type FicheDesktopAnnoncee = z.infer<typeof FicheDesktopAnnoncee>;
