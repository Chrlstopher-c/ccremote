// Responsabilité : les routes des synchronisations sur demande (Lanterne) — demander, lister, décider, journal.
// Elles ne font que relayer vers ServiceSynchro : aucune décision ici.
import { z } from 'zod';
import { Quoi } from '../../commun/synchro.ts';
import { erreur, json, lireCorps } from '../clients/http.ts';
import type { ServiceSynchro } from './service.ts';

export type Requete = Request & { params: Record<string, string> };
export type Gestionnaire = (req: Requete) => Response | Promise<Response>;
export type RoutesSynchro = Record<string, Partial<Record<'GET' | 'POST', Gestionnaire>>>;
type Protection = (g: Gestionnaire) => Gestionnaire;

const CorpsDemande = z.object({ vers: z.string().regex(/^[a-f0-9]{12}$/), quoi: Quoi });
const CorpsDecision = z.object({ accord: z.boolean() });

export function routesSynchro(service: ServiceSynchro, protege: Protection): RoutesSynchro {
  return {
    '/api/synchro/demandes': {
      GET: protege(() => json(service.lister())),
      POST: protege(async (req) => {
        const c = await lireCorps(req, CorpsDemande);
        if (c instanceof Response) return c;
        const r = service.demander(c.vers, c.quoi);
        return r.ok ? json(r.valeur, 201) : erreur(r.raison, r.statut);
      }),
    },
    '/api/synchro/demandes/:id': {
      POST: protege(async (req) => {
        const c = await lireCorps(req, CorpsDecision);
        if (c instanceof Response) return c;
        return service.decider(req.params['id'] ?? '', c.accord) ? json({}) : erreur('demande introuvable', 404);
      }),
    },
    '/api/synchro/journal': { GET: protege(() => json(service.journal())) },
  };
}
