// Responsabilité : la table des routes de la vague « reste » (recherche, mémoire, jetons, commandes), protégées comme
// les autres routes clients. Déléguées depuis la table principale, comme l'entretien.
import type { ApiReste } from './api-reste.ts';

type Requete = Request & { params: Record<string, string> };
type Protection = (g: (req: Requete) => Response | Promise<Response>) => (req: Requete) => Response | Promise<Response>;

export function routesReste(api: ApiReste, protege: Protection) {
  return {
    '/api/recherche': { GET: protege((req) => api.recherche(req)) },
    '/api/machines/:id/memoire': { GET: protege((req) => api.memoire(req)) },
    '/api/sessions/:id/jetons': { GET: protege((req) => api.jetons(req)) },
    '/api/machines/:id/commandes': {
      GET: protege((req) => api.commandes(req)),
      POST: protege((req) => api.creerCommande(req)),
    },
  };
}
