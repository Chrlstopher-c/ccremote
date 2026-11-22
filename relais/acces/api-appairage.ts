// Responsabilité : les routes d'appairage d'un appareil — un appareil connecté crée un code, et qui présente un code
// valable reçoit une clé d'appareil. L'échange est ouvert (comme la connexion), avec la même limite de tentatives.
import type { Logger } from 'pino';
import { z } from 'zod';
import type { Acces } from './acces.ts';
import { ipDe } from '../clients/api.ts';
import { erreur, json, lireCorps } from '../clients/http.ts';

const CorpsAppairage = z.object({
  code: z.string().trim().min(1).max(40),
  nom: z.string().trim().min(1).max(80),
});

export interface Serveur {
  requestIP(req: Request): { readonly address: string } | null;
}
export type Gestionnaire = (
  req: Request & { params: Record<string, string> },
  serveur: Serveur,
) => Response | Promise<Response>;

/** Réserve une route aux appareils (genre « appareil ») : sans accès 401, avec un accès Claude 403. */
export function reserveAppareil(acces: Acces): (g: Gestionnaire) => Gestionnaire {
  return (g) => (req, serveur) => {
    const genre = acces.genre(req);
    if (genre === null) return erreur('non connecté', 401);
    return genre === 'appareil' ? g(req, serveur) : erreur('réservé aux appareils connectés par mot de passe', 403);
  };
}

export function routesAppairage(acces: Acces, journal: Logger): Record<string, Record<string, Gestionnaire>> {
  const reserve = reserveAppareil(acces);
  return {
    '/api/appareils/codes': {
      POST: reserve((req) => {
        const par = acces.lister(req).find((v) => v.courant)?.nom ?? 'appareil';
        const nouveau = acces.creerCodeAppairage(par);
        journal.info({ par }, 'code d’appairage créé');
        return json(nouveau, 201);
      }),
    },
    '/api/appareils/appairer': {
      POST: async (req, serveur) => {
        const c = await lireCorps(req, CorpsAppairage);
        if (c instanceof Response) return c;
        const r = acces.appairer(c.code, c.nom, ipDe(req, serveur.requestIP(req)?.address));
        if (r.ok) {
          journal.info({ nom: c.nom }, 'appareil appairé');
          return json({ cle: r.jeton });
        }
        return r.raison === 'trop_de_tentatives'
          ? erreur('trop de tentatives, réessaie plus tard', 429)
          : erreur('code refusé ou expiré', 401);
      },
    },
  };
}
