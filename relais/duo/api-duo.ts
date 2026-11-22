// Responsabilité : les routes du mode duo, protégées comme les autres routes clients (jeton habituel).
import {
  CorpsAccordModule,
  CorpsAppairage,
  CorpsDecision,
  CorpsDroits,
  CorpsMain,
  CorpsNom,
  CorpsOuvertureDuo,
  CorpsPartage,
  CorpsPresence,
  CorpsRejoindre,
} from '../../commun/duo.ts';
import { erreur, json, lireCorps } from '../clients/http.ts';
import type { Duo } from './duo.ts';
import type { Resultat } from './resultat.ts';

type Requete = Request & { params: Record<string, string> };
type Protection = (g: (req: Requete) => Response | Promise<Response>) => (req: Requete) => Response | Promise<Response>;

function rendre<T>(r: Resultat<T>): Response {
  return r.ok ? json(r.valeur) : erreur(r.raison, r.statut);
}

export function routesDuo(duo: Duo, protege: Protection) {
  return {
    ...routesLien(duo, protege),
    ...routesEchanges(duo, protege),
    ...routesAvances(duo, protege),
    ...routesAppairage(duo, protege),
  };
}

// Étape 7 : décision de Chris sur les empreintes d'un appairage par l'aiguilleur.
function routesAppairage(duo: Duo, protege: Protection) {
  return {
    '/api/duo/appairage': {
      POST: protege(async (req) => {
        const c = await lireCorps(req, CorpsAppairage);
        if (c instanceof Response) return c;
        const r = duo.confirmerAppairage(c.accord);
        return r.ok ? json({}) : erreur(r.raison, r.statut);
      }),
    },
  };
}

// Appairage, lien, partages, présence, droits et nom affiché.
function routesLien(duo: Duo, protege: Protection) {
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
    '/api/duo/nom': {
      POST: protege(async (req) => {
        const c = await lireCorps(req, CorpsNom);
        return c instanceof Response ? c : json(duo.majNom(c.nom));
      }),
    },
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
    '/api/duo/droits': {
      GET: protege(() => json(duo.droitsAccordes())),
      POST: protege(async (req) => {
        const c = await lireCorps(req, CorpsDroits);
        return c instanceof Response ? c : json(duo.majDroits(c));
      }),
    },
  };
}

// Échanges à deux : demandes d'accord, sessions du pair, dossiers, usage, journal.
function routesEchanges(duo: Duo, protege: Protection) {
  return {
    '/api/duo/demandes': { GET: protege(() => json(duo.listerDemandes())) },
    '/api/duo/demandes/:id': {
      POST: protege(async (req) => {
        const c = await lireCorps(req, CorpsDecision);
        if (c instanceof Response) return c;
        const choix = c.machine && c.chemin ? { machine: c.machine, chemin: c.chemin } : undefined;
        return duo.decider(req.params['id'] ?? '', c.accord, choix) ? json({}) : erreur('demande introuvable', 404);
      }),
    },
    '/api/duo/sessions': {
      POST: protege(async (req) => {
        const c = await lireCorps(req, CorpsOuvertureDuo);
        if (c instanceof Response) return c;
        const r = await duo.ouvrirChezPair(c);
        if (!r.ok) return erreur(r.raison, r.statut);
        return r.valeur.etat === 'en_attente'
          ? json({ demande: r.valeur.demande, etat: 'en_attente' }, 202)
          : json({ session: r.valeur.session }, 201);
      }),
    },
    '/api/duo/dossiers': {
      GET: protege(async () => {
        const r = await duo.dossiersDuPair();
        return r.ok ? json({ dossiersOuverts: r.valeur }) : erreur(r.raison, r.statut);
      }),
    },
    '/api/duo/usage': { GET: protege(async () => rendre(await duo.usageDuPair())) },
    '/api/duo/journal': { GET: protege(() => json(duo.journalDuo())) },
  };
}

// Étape 3 : passer la main, modules en commun, alertes de conflit, fil d'activité.
function routesAvances(duo: Duo, protege: Protection) {
  return {
    '/api/duo/mains': {
      POST: protege(async (req) => {
        const c = await lireCorps(req, CorpsMain);
        if (c instanceof Response) return c;
        const r = await duo.avances.passerLaMain(c.session, c.note);
        if (!r.ok) return erreur(r.raison, r.statut);
        return r.valeur.etat === 'en_attente'
          ? json({ demande: r.valeur.demande, etat: 'en_attente' }, 202)
          : json({ sessionPair: r.valeur.session });
      }),
    },
    '/api/duo/modules': { GET: protege(() => json(duo.avances.listerModules())) },
    '/api/duo/modules/:id': {
      POST: protege(async (req) => {
        const c = await lireCorps(req, CorpsAccordModule);
        if (c instanceof Response) return c;
        return rendre(duo.avances.accorderModule(req.params['id'] ?? '', c.accepte));
      }),
    },
    '/api/duo/conflits': { GET: protege(() => json(duo.avances.conflitsDuo())) },
    '/api/duo/activite': { GET: protege(() => json(duo.avances.activite())) },
  };
}
