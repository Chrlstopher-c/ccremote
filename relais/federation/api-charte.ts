// Responsabilité : les routes de la charte du réseau (Paramètres › Réseau), protégées comme les autres routes.
// Elles relaient vers CharteNoeud, sans règle. `/api/reseau` n'est jamais servi à un appareil (appareils.ts).
// Création possible si ce nœud n'a pas de charte et qu'il est relié à un aiguilleur (il lui faut son identifiant).
import { z } from 'zod';
import { changerMembre, Droits, nommerChef, retirerMembre, type Charte } from '../../commun/charte.ts';
import { erreur, json, lireCorps } from '../clients/http.ts';
import type { CharteNoeud } from './charte-noeud.ts';
import type { Resultat } from './resultat.ts';

type Requete = Request & { params: Record<string, string> };
type Protection = (g: (req: Requete) => Response | Promise<Response>) => (req: Requete) => Response | Promise<Response>;
/** Ce que les routes utilisent de la charte : lecture, création, édition. */
export type PortRoutesCharte = Pick<CharteNoeud, 'charte' | 'moi' | 'chefLocal' | 'creer' | 'editer'>;

const ID_MEMBRE = /^[a-f0-9]{12}$/;
const NOM = z.string().trim().min(1).max(80);
const CorpsNom = z.object({ nom: NOM });
const CorpsChef = z.object({ membre: z.string().regex(ID_MEMBRE), chef: z.boolean() });
const CorpsMembre = z.object({
  droits: Droits.optional(),
  compte: z.string().max(200).nullable().optional(),
  nom: NOM.optional(),
});

/** Forme commune des réponses : la charte (ou null), ce nœud, s'il est chef, et s'il peut créer le réseau. */
function vue(port: PortRoutesCharte) {
  const charte = port.charte();
  const moi = port.moi();
  return { charte, moi, chef: port.chefLocal(), peutCreer: charte === null && moi !== null };
}

function rendre(port: PortRoutesCharte, r: Resultat<Charte>): Response {
  return r.ok ? json(vue(port)) : erreur(r.raison, r.statut);
}

function membreDe(req: Requete): string | null {
  const membre = req.params['membre'] ?? '';
  return ID_MEMBRE.test(membre) ? membre : null;
}

export function routesCharte(port: PortRoutesCharte, protege: Protection) {
  return { ...routesLecture(port, protege), ...routesEdition(port, protege) };
}

function routesLecture(port: PortRoutesCharte, protege: Protection) {
  return {
    '/api/reseau/charte': {
      GET: protege(() => json(vue(port))),
      POST: protege(async (req) => {
        const c = await lireCorps(req, CorpsNom);
        return c instanceof Response ? c : rendre(port, await port.creer(c.nom));
      }),
    },
  };
}

function routesEdition(port: PortRoutesCharte, protege: Protection) {
  return {
    '/api/reseau/charte/chefs': {
      POST: protege(async (req) => {
        const c = await lireCorps(req, CorpsChef);
        if (c instanceof Response) return c;
        return rendre(port, await port.editer((ch, moi, le) => nommerChef(ch, moi, c.membre, c.chef, le)));
      }),
    },
    '/api/reseau/charte/membres/:membre': {
      POST: protege(async (req) => {
        const membre = membreDe(req);
        const c = await lireCorps(req, CorpsMembre);
        if (membre === null) return erreur('membre invalide', 400);
        if (c instanceof Response) return c;
        return rendre(port, await port.editer((ch, moi, le) => changerMembre(ch, moi, membre, c, le)));
      }),
    },
    '/api/reseau/charte/membres/:membre/retirer': {
      POST: protege(async (req) => {
        const membre = membreDe(req);
        if (membre === null) return erreur('membre invalide', 400);
        return rendre(port, await port.editer((ch, moi, le) => retirerMembre(ch, moi, membre, le)));
      }),
    },
  };
}
