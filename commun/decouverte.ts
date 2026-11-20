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
});
export type Decouverte = z.infer<typeof Decouverte>;
