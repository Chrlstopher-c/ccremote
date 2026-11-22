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
});
export type CadreInvite = z.infer<typeof CadreInvite>;
