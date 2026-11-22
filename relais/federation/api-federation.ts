// Responsabilité : les routes de la fédération « mes machines », protégées comme les autres routes clients (jeton
// habituel). Elles ne font que relayer vers Federation : aucune décision ici.
import { z } from 'zod';
import { erreur, json, lireCorps } from '../clients/http.ts';
import type { Federation } from './federation.ts';
import type { Resultat } from './resultat.ts';

type Requete = Request & { params: Record<string, string> };
type Protection = (g: (req: Requete) => Response | Promise<Response>) => (req: Requete) => Response | Promise<Response>;

const CorpsAiguilleur = z.object({
  url: z.string().min(1).max(500),
  code: z.string().min(1).max(40),
  nom: z.string().trim().min(1).max(80),
  sansEcran: z.boolean().optional(),
});
const CorpsMembre = z.object({ membre: z.string().regex(/^[a-f0-9]{12}$/) });
const CorpsDirecte = z.object({
  ecoute: z.string().max(120).nullable().optional(),
  proprietaire: z.string().max(40).nullable().optional(),
  tunnels: z
    .array(
      z.object({
        hote: z.string().min(1).max(253),
        port: z.number().int(),
        utilisateur: z.string().min(1).max(32),
        cle: z.string().min(2).max(400),
        portLocal: z.number().int(),
        portDistant: z.number().int(),
      }),
    )
    .max(16)
    .optional(),
});
const CorpsAdresse = z.object({ adresse: z.string().min(3).max(120) });
const CorpsTransport = z.object({ adresse: z.string().min(3).max(120).nullable() });
const CorpsDecision = z.object({ accord: z.boolean() });
const CorpsTexte = z.object({ texte: z.string().min(1).max(200_000) });
const CorpsOuverture = z.object({
  membre: z.string().regex(/^[a-f0-9]{12}$/),
  machine: z.string().min(1).max(80),
  chemin: z.string().min(1).max(4096),
  message: z.string().min(1).max(200_000),
});

function rendre<T>(r: Resultat<T>): Response {
  return r.ok ? json(r.valeur) : erreur(r.raison, r.statut);
}

export function routesFederation(fede: Federation, protege: Protection) {
  return { ...routesLien(fede, protege), ...routesSessions(fede, protege) };
}

// État, rattachement à l'aiguilleur, appairage, décisions, révocation.
function routesLien(fede: Federation, protege: Protection) {
  return {
    '/api/federation': { GET: protege(async () => json(await fede.etat())) },
    '/api/federation/aiguilleur': {
      POST: protege(async (req) => {
        const c = await lireCorps(req, CorpsAiguilleur);
        return c instanceof Response ? c : rendre(await fede.rejoindreAiguilleur(c));
      }),
    },
    // Sans aiguilleur : écoute locale et propriétaire du réseau, puis premier contact à une adresse directe.
    '/api/federation/directe': {
      POST: protege(async (req) => {
        const c = await lireCorps(req, CorpsDirecte);
        return c instanceof Response ? c : rendre(fede.configurerDirecte(c));
      }),
    },
    '/api/federation/pairs/:membre/transport': {
      POST: protege(async (req) => {
        const c = await lireCorps(req, CorpsTransport);
        if (c instanceof Response) return c;
        return rendre(fede.transportPair(req.params['membre'] ?? '', c.adresse));
      }),
    },
    '/api/federation/directe/appairer': {
      POST: protege(async (req) => {
        const c = await lireCorps(req, CorpsAdresse);
        if (c instanceof Response) return c;
        return rendre(await fede.appairerDirect(c.adresse));
      }),
    },
    '/api/federation/appairer': {
      POST: protege(async (req) => {
        const c = await lireCorps(req, CorpsMembre);
        return c instanceof Response ? c : rendre(fede.appairer(c.membre));
      }),
    },
    '/api/federation/demandes/:id': {
      POST: protege(async (req) => {
        const c = await lireCorps(req, CorpsDecision);
        if (c instanceof Response) return c;
        const r = fede.decider(req.params['id'] ?? '', c.accord);
        return r.ok ? json({}) : erreur(r.raison, r.statut);
      }),
    },
    '/api/federation/revoquer': {
      POST: protege(async (req) => {
        const c = await lireCorps(req, CorpsMembre);
        return c instanceof Response ? c : rendre(fede.revoquer(c.membre));
      }),
    },
    // Les nœuds du réseau et leurs clés : un appareil admis les apprend par son canal, pour se relier sans appairage.
    '/api/appareils/noeuds': {
      GET: protege(async () => json(await fede.noeudsAppareil())),
    },
  };
}

// Sessions des autres nœuds : liste, fil, écriture, interruption, ouverture.
function routesSessions(fede: Federation, protege: Protection) {
  return {
    '/api/federation/sessions': {
      GET: protege(() => json(fede.distantes.sessions())),
      POST: protege(async (req) => {
        const c = await lireCorps(req, CorpsOuverture);
        if (c instanceof Response) return c;
        return rendre(await fede.distantes.ouvrir(c.membre, c.machine, c.chemin, c.message));
      }),
    },
    '/api/federation/sessions/:membre/:session/fil': {
      GET: protege(async (req) =>
        rendre(await fede.distantes.fil(req.params['membre'] ?? '', req.params['session'] ?? '')),
      ),
    },
    '/api/federation/sessions/:membre/:session/messages': {
      POST: protege(async (req) => {
        const c = await lireCorps(req, CorpsTexte);
        if (c instanceof Response) return c;
        return rendre(await fede.distantes.ecrire(req.params['membre'] ?? '', req.params['session'] ?? '', c.texte));
      }),
    },
    '/api/federation/sessions/:membre/:session/interrompre': {
      POST: protege(async (req) =>
        rendre(await fede.distantes.interrompre(req.params['membre'] ?? '', req.params['session'] ?? '')),
      ),
    },
  };
}
