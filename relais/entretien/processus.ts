// Responsabilité : les processus et chantiers reçus des postes — validation des réponses, et étiquetage des tunnels du
// poste local (le relais sait quel ssh ouvre quel tunnel ; le poste ne le sait pas).
import { z } from 'zod';
import { ChantierPoste, ProcessusPoste, TmuxPoste } from '../../commun/entretien.ts';

const ReponseProcessus = z.object({ processus: z.array(ProcessusPoste), tmux: z.array(TmuxPoste) });
const ReponseChantiers = z.object({ chantiers: z.array(ChantierPoste) });

/** Les processus et sessions tmux d'un poste ; null si la réponse n'a pas la bonne forme. */
export function lireProcessusRecus(donnees: unknown): z.infer<typeof ReponseProcessus> | null {
  const r = ReponseProcessus.safeParse(donnees);
  return r.success ? r.data : null;
}

export function lireChantiersRecus(donnees: unknown): ChantierPoste[] | null {
  const r = ReponseChantiers.safeParse(donnees);
  return r.success ? r.data.chantiers : null;
}

/** Un tunnel ouvert par le relais, reconnu par son PID, prend le nom de la machine qu'il dessert. */
export function etiqueterTunnels(
  processus: readonly ProcessusPoste[],
  tunnels: readonly { readonly id: string; readonly pid: number }[],
): ProcessusPoste[] {
  return processus.map((p) => {
    if (p.role !== 'tunnel') return p;
    const tunnel = tunnels.find((t) => t.pid === p.pid);
    return tunnel ? { ...p, commande: `Tunnel SSH vers ${tunnel.id}` } : p;
  });
}
