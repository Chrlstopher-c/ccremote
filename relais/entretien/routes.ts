// Responsabilité : la table des routes de l'entretien (`/api/entretien/*` et le réveil des machines), protégées comme
// les autres routes clients. Déléguées depuis la table principale, comme les fichiers.
import type { ApiEntretien } from './api-entretien.ts';

type Requete = Request & { params: Record<string, string> };
type Protection = (g: (req: Requete) => Response | Promise<Response>) => (req: Requete) => Response | Promise<Response>;

export function routesEntretien(api: ApiEntretien, protege: Protection) {
  return {
    '/api/entretien/etat': { GET: protege(() => api.etat()) },
    '/api/entretien/chantiers': { GET: protege(() => api.chantiers()) },
    '/api/entretien/processus': { GET: protege(() => api.processus()) },
    '/api/entretien/processus/arreter': { POST: protege((req) => api.arreterProcessus(req)) },
    '/api/entretien/tmux/arreter': { POST: protege((req) => api.arreterTmux(req)) },
    '/api/entretien/liaisons/:id/occupant': { GET: protege((req) => api.occupant(req.params['id'] ?? '')) },
    '/api/entretien/liaisons/:id/liberer': { POST: protege((req) => api.liberer(req)) },
    '/api/machines/:id/reveiller': { POST: protege((req) => api.reveiller(req.params['id'] ?? '')) },
  };
}
