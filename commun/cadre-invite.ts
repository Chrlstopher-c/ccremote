// Responsabilité : le cadre qu'un nœud reçoit pour lancer une session d'invité (dossier, config, racines, prompt).
import { z } from 'zod';

export const CadreInvite = z.object({
  membre: z.string().regex(/^[a-f0-9]{12}$/), // l'invité pour qui la session tourne
  nom: z.string().min(1).max(80),
  espace: z.string().min(1).max(4096), // dossier de travail, seul lieu d'écriture
  config: z.string().min(1).max(4096), // dossier de configuration Claude dédié (sans identifiants)
  lecture: z.array(z.string().max(4096)).max(50), // racines lisibles en plus de l'espace
  prompt: z.string().max(8000), // prompt système imposé par le chef
  remoteControl: z.boolean(),
  // Relais Claude du nœud de l'invité : Claude Code pointe ici au lieu de l'API (le jeton du chef n'est pas requis).
  relais: z.strictObject({ url: z.string().min(1).max(512), jeton: z.string().min(32).max(128) }).optional(),
});
export type CadreInvite = z.infer<typeof CadreInvite>;
