// Responsabilité : la route de l'appli qui demande un code d'appairage (`POST /api/federation/codes`), protégée comme
// les
// autres routes clients. Elle valide le corps et relaie vers CodesReseau ; aucune décision ici.
import { CorpsCodeMembre } from '../../commun/aiguilleur.ts';
import { erreur, json, lireCorps } from '../clients/http.ts';
import type { CodesReseau } from './codes-reseau.ts';

type Requete = Request & { params: Record<string, string> };
type Protection = (g: (req: Requete) => Response | Promise<Response>) => (req: Requete) => Response | Promise<Response>;

export function routesCodesReseau(codes: CodesReseau, protege: Protection) {
  return {
    '/api/federation/codes': {
      POST: protege(async (req) => {
        const corps = await lireCorps(req, CorpsCodeMembre);
        if (corps instanceof Response) return corps;
        const r = await codes.creer(corps);
        return r.ok ? json(r.valeur) : erreur(r.raison, r.statut);
      }),
    },
  };
}
