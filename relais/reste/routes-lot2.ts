// Responsabilité : la table des routes du lot 2 de la vague « reste » (compactions, PR, dictée, voix, tâches),
// protégées comme les autres routes clients. Déléguées depuis la table principale, comme la vague « reste ».
import type { ApiDictee } from './api-dictee.ts';
import type { ApiResteSessions } from './api-reste-sessions.ts';
import type { ApiServiceVoix } from './api-voix-service.ts';
import type { ApiTaches } from './api-taches.ts';

type Requete = Request & { params: Record<string, string> };
type Protection = (g: (req: Requete) => Response | Promise<Response>) => (req: Requete) => Response | Promise<Response>;

export interface ApisResteLot2 {
  readonly sessions: ApiResteSessions;
  readonly dictee: ApiDictee;
  readonly taches: ApiTaches;
  readonly voix: ApiServiceVoix;
}

export function routesResteLot2(api: ApisResteLot2, protege: Protection) {
  return {
    '/api/sessions/:id/compactions': { GET: protege((req) => api.sessions.compactions(req)) },
    '/api/sessions/:id/pr': {
      GET: protege((req) => api.sessions.etatFusion(req)),
      POST: protege((req) => api.sessions.creerFusion(req)),
    },
    '/api/dictee': {
      GET: protege(() => api.dictee.etat()),
      POST: protege((req) => api.dictee.transcrire(req)),
    },
    '/api/dictee/service': { GET: protege((req) => api.dictee.service(req)) },
    '/api/machines/:id/dictee': { POST: protege((req) => api.dictee.piloter(req)) },
    '/api/voix/service': { GET: protege((req) => api.voix.service(req)) },
    '/api/machines/:id/voix': { POST: protege((req) => api.voix.piloter(req)) },
    '/api/machines/:id/taches-planifiees': { GET: protege((req) => api.taches.lister(req)) },
    '/api/machines/:id/taches-planifiees/:tid': {
      PUT: protege((req) => api.taches.enregistrer(req)),
      DELETE: protege((req) => api.taches.supprimer(req)),
    },
    '/api/machines/:id/taches-planifiees/:tid/executer': { POST: protege((req) => api.taches.executer(req)) },
  };
}
