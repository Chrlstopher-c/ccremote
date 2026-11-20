// Responsabilité : la table des routes de la parité d'une session (contexte, tâche, résultat), protégées comme les
// autres routes clients. Montées depuis la table principale, à côté du lot 2.
import type { ApiParite } from './api-parite.ts';

type Requete = Request & { params: Record<string, string> };
type Protection = (g: (req: Requete) => Response | Promise<Response>) => (req: Requete) => Response | Promise<Response>;

export function routesParite(api: ApiParite, protege: Protection) {
  return {
    '/api/sessions/:id/parite': { GET: protege((req) => api.parite(req)) },
    '/api/sessions/:id/parite/taches/:tache': { GET: protege((req) => api.tache(req)) },
    '/api/sessions/:id/parite/resultat': { GET: protege((req) => api.resultat(req)) },
  };
}
