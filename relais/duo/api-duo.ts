// Responsabilité : les routes du mode duo, protégées comme les autres routes clients (jeton habituel). Une route
// agit sur l'emplacement d'un ami (`?ami=<id>`, le principal sans ce paramètre) ; les demandes, sans `?ami`,
// rassemblent tous les amis. Une route reçoit aussi bien un Duo seul (tests) qu'une liste d'amis.
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
import { ID_AMI_PRINCIPAL } from '../../commun/duo-amis.ts';
import { erreur, json, lireCorps } from '../clients/http.ts';
import type { AmisDuo } from './amis.ts';
import { Duo } from './duo.ts';
import type { Resultat } from './resultat.ts';

export type Requete = Request & { params: Record<string, string> };
export type Route = (req: Requete) => Response | Promise<Response>;
export type Protection = (g: Route) => Route;
type Cible = Duo | AmisDuo;
type Action = (duo: Duo, req: Requete) => Response | Promise<Response>;
interface Gardes {
  readonly cible: Cible;
  readonly protege: Protection;
  readonly parAmi: (action: Action) => Route;
}

function rendre<T>(r: Resultat<T>): Response {
  return r.ok ? json(r.valeur) : erreur(r.raison, r.statut);
}

function identifiantAmi(req: Requete): string | null {
  return new URL(req.url).searchParams.get('ami');
}

// Sans `?ami` : le principal. Un identifiant inconnu : 404.
function instancePour(cible: Cible, req: Requete): Duo | Response {
  if (cible instanceof Duo) return cible;
  return cible.instance(identifiantAmi(req) ?? ID_AMI_PRINCIPAL) ?? erreur('ami introuvable', 404);
}

// Sans `?ami` : tous les amis. Un identifiant inconnu : 404.
function ciblesPour(cible: Cible, req: Requete): Duo[] | Response {
  if (cible instanceof Duo) return [cible];
  const id = identifiantAmi(req);
  if (id === null) return cible.tous();
  const duo = cible.instance(id);
  return duo ? [duo] : erreur('ami introuvable', 404);
}

export function routesDuo(cible: Cible, protege: Protection) {
  const parAmi = (action: Action): Route =>
    protege((req) => {
      const duo = instancePour(cible, req);
      return duo instanceof Response ? duo : action(duo, req);
    });
  const gardes: Gardes = { cible, protege, parAmi };
  return {
    ...routesLien(gardes),
    ...routesDemandes(gardes),
    ...routesEchanges(gardes),
    ...routesAvances(gardes),
    ...routesAppairage(gardes),
  };
}

// Étape 7 : décision de Chris sur les empreintes d'un appairage par l'aiguilleur.
function routesAppairage({ parAmi }: Gardes) {
  return {
    '/api/duo/appairage': {
      POST: parAmi(async (duo, req) => {
        const c = await lireCorps(req, CorpsAppairage);
        if (c instanceof Response) return c;
        const r = duo.confirmerAppairage(c.accord);
        return r.ok ? json({}) : erreur(r.raison, r.statut);
      }),
    },
  };
}

// Appairage, lien, partages, présence, droits et nom affiché (le nom est commun à tous les amis).
function routesLien({ cible, protege, parAmi }: Gardes) {
  return {
    '/api/duo': { GET: parAmi((duo) => json(duo.etat())) },
    '/api/duo/code': { POST: parAmi((duo) => rendre(duo.codeAppairage())) },
    '/api/duo/rejoindre': {
      POST: parAmi(async (duo, req) => {
        const c = await lireCorps(req, CorpsRejoindre);
        return c instanceof Response ? c : rendre(await duo.rejoindre(c.adresse, c.code));
      }),
    },
    '/api/duo/revoquer': { POST: parAmi((duo) => json(duo.revoquer())) },
    '/api/duo/nom': {
      POST: protege(async (req) => {
        const c = await lireCorps(req, CorpsNom);
        return c instanceof Response ? c : json(cible.majNom(c.nom));
      }),
    },
    '/api/duo/partages': {
      POST: parAmi(async (duo, req) => {
        const c = await lireCorps(req, CorpsPartage);
        return c instanceof Response ? c : rendre(duo.partager(c));
      }),
    },
    '/api/duo/partages/:cible': {
      DELETE: parAmi((duo, req) => rendre(duo.retirerPartage(decodeURIComponent(req.params['cible'] ?? '')))),
    },
    '/api/duo/presence': {
      POST: parAmi(async (duo, req) => {
        const c = await lireCorps(req, CorpsPresence);
        if (c instanceof Response) return c;
        const r = duo.signalerPresence(c.session, c.present);
        return r.ok ? json({}) : erreur(r.raison, r.statut);
      }),
    },
    '/api/duo/droits': {
      GET: parAmi((duo) => json(duo.droitsAccordes())),
      POST: parAmi(async (duo, req) => {
        const c = await lireCorps(req, CorpsDroits);
        return c instanceof Response ? c : json(duo.majDroits(c));
      }),
    },
  };
}

// Demandes d'accord : sans `?ami`, celles de tous les amis ; la décision est portée par la demande, où qu'elle soit.
function routesDemandes({ cible, protege }: Gardes) {
  return {
    '/api/duo/demandes': {
      GET: protege((req) => {
        const cibles = ciblesPour(cible, req);
        return cibles instanceof Response ? cibles : json(cibles.flatMap((duo) => duo.listerDemandes()));
      }),
    },
    '/api/duo/demandes/:id': {
      POST: protege(async (req) => {
        const c = await lireCorps(req, CorpsDecision);
        if (c instanceof Response) return c;
        const cibles = ciblesPour(cible, req);
        if (cibles instanceof Response) return cibles;
        const choix = c.machine && c.chemin ? { machine: c.machine, chemin: c.chemin } : undefined;
        const id = req.params['id'] ?? '';
        return cibles.some((duo) => duo.decider(id, c.accord, choix)) ? json({}) : erreur('demande introuvable', 404);
      }),
    },
  };
}

// Échanges à deux : sessions du pair, dossiers, usage, journal.
function routesEchanges({ parAmi }: Gardes) {
  return {
    '/api/duo/sessions': {
      POST: parAmi(async (duo, req) => {
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
      GET: parAmi(async (duo) => {
        const r = await duo.dossiersDuPair();
        return r.ok ? json({ dossiersOuverts: r.valeur }) : erreur(r.raison, r.statut);
      }),
    },
    '/api/duo/usage': { GET: parAmi(async (duo) => rendre(await duo.usageDuPair())) },
    '/api/duo/journal': { GET: parAmi((duo) => json(duo.journalDuo())) },
  };
}

// Étape 3 : passer la main, modules en commun, alertes de conflit, fil d'activité.
function routesAvances({ parAmi }: Gardes) {
  return {
    '/api/duo/mains': {
      POST: parAmi(async (duo, req) => {
        const c = await lireCorps(req, CorpsMain);
        if (c instanceof Response) return c;
        const r = await duo.avances.passerLaMain(c.session, c.note);
        if (!r.ok) return erreur(r.raison, r.statut);
        return r.valeur.etat === 'en_attente'
          ? json({ demande: r.valeur.demande, etat: 'en_attente' }, 202)
          : json({ sessionPair: r.valeur.session });
      }),
    },
    '/api/duo/modules': { GET: parAmi((duo) => json(duo.avances.listerModules())) },
    '/api/duo/modules/:id': {
      POST: parAmi(async (duo, req) => {
        const c = await lireCorps(req, CorpsAccordModule);
        if (c instanceof Response) return c;
        return rendre(duo.avances.accorderModule(req.params['id'] ?? '', c.accepte));
      }),
    },
    '/api/duo/conflits': { GET: parAmi((duo) => json(duo.avances.conflitsDuo())) },
    '/api/duo/activite': { GET: parAmi((duo) => json(duo.avances.activite())) },
  };
}
