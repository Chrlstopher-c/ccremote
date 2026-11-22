// Responsabilité : les routes de « Ajouter une machine au réseau », protégées comme les autres routes clients. Elles ne
// font que relayer vers AjoutNoeud : aucune décision ici. Jamais relayées à un autre nœud (hors /api/sessions).
import { CorpsAjoutNoeud, ID_MACHINE_AJOUT } from '../../commun/ajout-noeud.ts';
import { erreur, json, lireCorps } from '../clients/http.ts';
import type { Resultat } from '../federation/resultat.ts';
import type { AjoutNoeud } from './ajout-noeud.ts';

type Requete = Request & { params: Record<string, string> };
type Protection = (g: (req: Requete) => Response | Promise<Response>) => (req: Requete) => Response | Promise<Response>;

function rendre<T>(r: Resultat<T>, statut = 200): Response {
  return r.ok ? json(r.valeur ?? {}, statut) : erreur(r.raison, r.statut);
}

function machineDe(req: Requete): string | null {
  const m = req.params['machine'] ?? '';
  return ID_MACHINE_AJOUT.test(m) ? m : null;
}

export function routesAjoutNoeud(ajout: AjoutNoeud, protege: Protection) {
  return {
    '/api/reseau/ajouts': {
      GET: protege(() => json(ajout.liste())),
      POST: protege(async (req) => {
        const c = await lireCorps(req, CorpsAjoutNoeud);
        return c instanceof Response ? c : rendre(await ajout.lancer(c), 202);
      }),
    },
    '/api/reseau/ajouts/:machine/accepter': {
      POST: protege((req) => {
        const m = machineDe(req);
        return m ? rendre(ajout.accepter(m)) : erreur('machine invalide', 400);
      }),
    },
    '/api/reseau/ajouts/:machine/retour': {
      POST: protege(async (req) => {
        const m = machineDe(req);
        return m ? rendre(await ajout.retour(m)) : erreur('machine invalide', 400);
      }),
    },
  };
}
