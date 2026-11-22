// Responsabilité : les routes « machines du réseau » de l'appli (état de chaque machine, actions de chef) — elles ne
// font que relayer vers Federation, protégées comme les autres routes de l'appli. `/api/reseau` reste refusé aux
// appareils.
import { z } from 'zod';
import { erreur, json, lireCorps } from '../clients/http.ts';
import type { Federation } from './federation.ts';
import { ACTIONS_MACHINE } from './actions-noeud.ts';

type Requete = Request & { params: Record<string, string> };
type Protection = (g: (req: Requete) => Response | Promise<Response>) => (req: Requete) => Response | Promise<Response>;

const CorpsAction = z.object({ action: z.enum(ACTIONS_MACHINE) });
const MEMBRE_MACHINE = /^(?:[a-f0-9]{12}|moi)$/;

export function routesMachinesReseau(fede: Federation, protege: Protection) {
  return {
    '/api/reseau/machines': {
      GET: protege(async () => json({ machines: await fede.machinesReseau() })),
    },
    '/api/reseau/machines/:membre/action': {
      POST: protege(async (req) => {
        const membre = req.params['membre'] ?? '';
        if (!MEMBRE_MACHINE.test(membre)) return erreur('machine inconnue', 400);
        const c = await lireCorps(req, CorpsAction);
        if (c instanceof Response) return c;
        const r = await fede.agirSurMachine(membre, c.action);
        return r.ok ? json({ ok: true }) : erreur(r.raison, r.statut);
      }),
    },
  };
}
