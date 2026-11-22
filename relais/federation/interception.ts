// Responsabilité : brancher la fédération sur les routes des clients — une requête authentifiée qui vise une session
// ou une machine d'un autre nœud est relayée à ce nœud ; sinon la route locale répond. Une requête non authentifiée
// va toujours à la route locale, qui la refuse.
import type { Distantes } from './distantes.ts';

type Gestionnaire = (req: Request & { params: Record<string, string> }, serveur?: unknown) => unknown;

function estRelayable(cle: string): boolean {
  return cle === '/api/sessions' || cle.startsWith('/api/sessions/:id/') || cle.startsWith('/api/machines/:id/');
}

/** Rend la même table, les routes de sessions enveloppées par le relais vers les autres nœuds. */
export function relayerVersNoeuds<T extends Record<string, object>>(
  table: T,
  distantes: Distantes,
  autorise: (req: Request) => boolean,
): T {
  for (const [cle, methodes] of Object.entries(table)) {
    if (!estRelayable(cle)) continue;
    // Les valeurs de la table sont des gestionnaires par méthode HTTP (forme des routes de Bun.serve).
    const parMethode = methodes as Record<string, Gestionnaire>;
    for (const [methode, gestionnaire] of Object.entries(parMethode)) {
      parMethode[methode] = async (req, serveur) => {
        if (autorise(req)) {
          const relayee = await distantes.intercepter(req);
          if (relayee) return relayee;
        }
        return gestionnaire(req, serveur);
      };
    }
  }
  return table;
}
