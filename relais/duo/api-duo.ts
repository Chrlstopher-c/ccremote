// Responsabilité : les routes du mode duo, protégées comme les autres routes clients (jeton habituel).
import { CorpsPartage, CorpsPresence, CorpsRejoindre } from '../../commun/duo.ts';
import { erreur, json, lireCorps } from '../clients/http.ts';
import type { Duo, Resultat } from './duo.ts';

type Requete = Request & { params: Record<string, string> };
type Protection = (g: (req: Requete) => Response | Promise<Response>) => (req: Requete) => Response | Promise<Response>;

function rendre<T>(r: Resultat<T>): Response {
  return r.ok ? json(r.valeur) : erreur(r.raison, r.statut);
}

export function routesDuo(duo: Duo, protege: Protection) {
  return {
    '/api/duo': { GET: protege(() => json(duo.etat())) },
    '/api/duo/code': { POST: protege(() => rendre(duo.codeAppairage())) },
    '/api/duo/rejoindre': {
      POST: protege(async (req) => {
        const c = await lireCorps(req, CorpsRejoindre);
        return c instanceof Response ? c : rendre(await duo.rejoindre(c.adresse, c.code));
      }),
    },
    '/api/duo/revoquer': { POST: protege(() => json(duo.revoquer())) },
    '/api/duo/partages': {
      POST: protege(async (req) => {
        const c = await lireCorps(req, CorpsPartage);
        return c instanceof Response ? c : rendre(duo.partager(c));
      }),
    },
    '/api/duo/partages/:cible': {
      DELETE: protege((req) => rendre(duo.retirerPartage(decodeURIComponent(req.params['cible'] ?? '')))),
    },
    '/api/duo/presence': {
      POST: protege(async (req) => {
        const c = await lireCorps(req, CorpsPresence);
        if (c instanceof Response) return c;
        const r = duo.signalerPresence(c.session, c.present);
        return r.ok ? json({}) : erreur(r.raison, r.statut);
      }),
    },
  };
}
