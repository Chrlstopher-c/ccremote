// Responsabilité : la table des routes de l'API des clients (web, iPhone), toutes protégées sauf la connexion.
import { z } from 'zod';
import type { Acces } from '../acces/acces.ts';
import { cookieDeSession } from '../acces/acces.ts';
import type { Postes } from '../parc/postes.ts';
import { reveiller } from '../parc/reveil.ts';
import type { Registre } from '../registre/registre.ts';
import type { ApiArtefacts } from './api-artefacts.ts';
import type { ApiModifications } from './api-modifications.ts';
import type { ApiFichiersSession } from './api-fichiers-session.ts';
import type { ApiSessions } from './api-sessions.ts';
import type { ApiSessionConfig } from './api-session-config.ts';
import type { ApiConfiguration } from './api-configuration.ts';
import type { ApiComptes } from './api-comptes.ts';
import { type ApiFichiers, routesFichiers } from '../appareils/api-fichiers.ts';
import type { Diffusion } from './diffusion.ts';
import type { LienEcho } from '../echo/lien-echo.ts';
import { routesEcho } from '../echo/api-echo.ts';
import type { ApiMachines } from '../machines/api-machines.ts';
import type { ApiConfirmations } from '../machines/api-confirmations.ts';
import { type DependancesReunions, routesReunions } from '../reunion/api-reunions.ts';
import { entier, erreur, json, lireCorps, REFUS_POSTE } from './http.ts';

export interface DependancesApi {
  readonly acces: Acces;
  readonly registre: Registre;
  readonly postes: Postes;
  readonly diffusion: Diffusion;
  readonly sessions: ApiSessions;
  readonly sessionConfig: ApiSessionConfig;
  readonly configuration: ApiConfiguration;
  readonly comptes: ApiComptes;
  readonly fichiers: ApiFichiers;
  readonly artefacts: ApiArtefacts;
  readonly modifications: ApiModifications;
  readonly fichiersSession: ApiFichiersSession;
  readonly echo: LienEcho | null;
  readonly reunions: DependancesReunions;
  readonly wol: ReadonlyMap<string, string>;
  readonly diffusionWol: string;
  readonly machines: ApiMachines;
  readonly confirmations: ApiConfirmations;
}

type Gestionnaire = (req: Request & { params: Record<string, string> }) => Response | Promise<Response>;
interface Serveur {
  requestIP(req: Request): { readonly address: string } | null;
}
const CorpsConnexion = z.object({ motDePasse: z.string().min(1).max(512), appareil: z.string().max(120).optional() });

const BOUCLE_LOCALE = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

// Les en-têtes d'IP ne valent que posés par le tunnel local ; venus d'ailleurs, n'importe qui peut les écrire.
export function ipDe(req: Request, pair: string | undefined): string {
  if (!pair) return 'inconnue';
  if (!BOUCLE_LOCALE.has(pair)) return pair;
  return req.headers.get('cf-connecting-ip') ?? req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? pair;
}

function protegerAvec(acces: Acces): (g: Gestionnaire) => Gestionnaire {
  return (g) => (req) => (acces.autorise(req) ? g(req) : erreur('non connecté', 401));
}

export function construireRoutes(d: DependancesApi) {
  const protege = protegerAvec(d.acces);
  return {
    '/api/connexion': { POST: (req: Request, serveur: Serveur) => connexion(d, req, serveur) },
    '/api/deconnexion': {
      POST: protege((req) => {
        d.acces.deconnecter(req);
        return json({ ok: true }, 200, { 'set-cookie': 'ccremote=; Path=/; Max-Age=0' });
      }),
    },
    '/api/etat': { GET: protege((req) => json(etat(d, req))) },
    '/api/attente': { GET: protege((req) => attente(d, req)) },
    '/api/sessions': { POST: protege((req) => d.sessions.ouvrir(req)) },
    '/api/sessions/:id/evenements': { GET: protege((req) => d.sessions.evenements(req as never)) },
    '/api/sessions/:id/contexte': { GET: protege((req) => d.sessions.contexte(req as never)) },
    '/api/sessions/:id/connecteurs': { GET: protege((req) => d.sessions.connecteurs(req as never)) },
    '/api/sessions/:id/taches': { GET: protege((req) => d.sessions.taches(req as never)) },
    '/api/sessions/:id/taches/:tache': { GET: protege((req) => d.sessions.tache(req as never)) },
    '/api/sessions/:id/taches/:tache/arreter': { POST: protege((req) => d.sessions.arreterTache(req as never)) },
    '/api/sessions/:id/messages': { POST: protege((req) => d.sessions.envoyer(req as never)) },
    '/api/sessions/:id/fichiers/:fichier': { GET: protege((req) => d.sessions.fichier(req as never)) },
    '/api/sessions/:id/autonomie': { POST: protege((req) => d.sessions.autonomie(req as never)) },
    '/api/sessions/:id/nuit': { POST: protege((req) => d.sessions.nuit(req as never)) },
    '/api/sessions/:id/remote-control': { POST: protege((req) => d.sessions.remoteControl(req as never)) },
    '/api/sessions/:id/repondre': { POST: protege((req) => d.sessions.repondre(req as never)) },
    '/api/sessions/:id/rembobiner': { POST: protege((req) => d.sessions.rembobiner(req as never)) },
    '/api/sessions/:id/dupliquer': { POST: protege((req) => d.sessions.dupliquer(req as never)) },
    '/api/sessions/:id/style': { POST: protege((req) => d.sessionConfig.style(req as never)) },
    '/api/sessions/:id/styles': { GET: protege((req) => d.sessionConfig.styles(req as never)) },
    '/api/sessions/:id/connecteurs/:nom': { POST: protege((req) => d.sessionConfig.connecteur(req as never)) },
    '/api/sessions/:id/annexes': {
      GET: protege((req) => d.sessionConfig.annexes(req as never)),
      POST: protege((req) => d.sessionConfig.annexer(req as never)),
    },
    '/api/sessions/:id/chapitres': {
      GET: protege((req) => d.sessions.chapitres(req as never)),
      POST: protege((req) => d.sessions.chapitre(req as never)),
    },
    '/api/sessions/:id/supprimer': { POST: protege((req) => d.sessions.supprimer(req as never)) },
    '/api/environnements': {
      GET: protege(() => d.sessions.environnements()),
      POST: protege((req) => d.sessions.enregistrerEnvironnement(req)),
    },
    '/api/machines/config': {
      GET: protege(() => d.machines.liste()),
      POST: protege((req) => d.machines.ajouter(req)),
    },
    '/api/machines/config/:id': {
      PATCH: protege((req) => d.machines.modifier(req as never)),
      DELETE: protege((req) => d.machines.supprimer(req as never)),
    },
    '/api/machines/config/:id/tester': { POST: protege((req) => d.machines.tester(req as never)) },
    '/api/machines/config/:id/installer': { POST: protege((req) => d.machines.installer(req as never)) },
    '/api/machines/config/:id/installation': { GET: protege((req) => d.machines.suivi(req as never)) },
    '/api/machines/:id/dossiers': { GET: protege((req) => d.machines.dossiers(req as never)) },
    '/api/machines/:id/styles': { POST: protege((req) => d.configuration.creerStyle(req as never)) },
    '/api/machines/:id/instructions': {
      GET: protege((req) => d.configuration.instructions(req as never)),
      PUT: protege((req) => d.configuration.ecrireInstructions(req as never)),
    },
    '/api/machines/:id/competences': { GET: protege((req) => d.configuration.competences(req as never)) },
    '/api/machines/:id/competences/contenu': { GET: protege((req) => d.configuration.contenuCompetence(req as never)) },
    '/api/machines/:id/connecteurs': {
      GET: protege((req) => d.configuration.connecteurs(req as never)),
      POST: protege((req) => d.configuration.ajouterConnecteur(req as never)),
    },
    '/api/machines/:id/connecteurs/:nom': {
      GET: protege((req) => d.configuration.connecteur(req as never)),
      PUT: protege((req) => d.configuration.modifierConnecteur(req as never)),
      DELETE: protege((req) => d.configuration.retirerConnecteur(req as never)),
    },
    '/api/machines/:id/plugins': { GET: protege((req) => d.configuration.plugins(req as never)) },
    '/api/machines/:id/plugins/:plugin': { POST: protege((req) => d.configuration.activerPlugin(req as never)) },
    '/api/confirmations': { POST: protege((req) => d.confirmations.demander(req)) },
    '/api/confirmations/:id': { GET: protege((req) => d.confirmations.lire(req as never)) },
    '/api/confirmations/:id/attendre': { GET: protege((req) => d.confirmations.attendre(req as never)) },
    '/api/confirmations/:id/reponse': { POST: protege((req) => d.confirmations.repondre(req as never)) },
    '/api/machines/:id/importables': { GET: protege((req) => d.sessions.importables(req as never)) },
    '/api/machines/:id/importer': { POST: protege((req) => d.sessions.importer(req as never)) },
    '/api/sessions/:id/mode': { POST: protege((req) => d.sessions.mode(req as never)) },
    '/api/sessions/:id/modele': { POST: protege((req) => d.sessions.modele(req as never)) },
    '/api/sessions/:id/effort': { POST: protege((req) => d.sessions.effort(req as never)) },
    '/api/sessions/:id/renommer': { POST: protege((req) => d.sessions.renommer(req as never)) },
    '/api/sessions/:id/:action': { POST: protege((req) => d.sessions.action(req as never)) },
    '/api/notifications': {
      GET: protege((req) => json(d.registre.notifications(entier(new URL(req.url).searchParams.get('apres'), 0)))),
    },
    '/api/notifications/lues': { POST: protege((req) => marquerLues(d, req)) },
    '/api/machines/:id/reveiller': { POST: protege((req) => reveil(d, req.params['id'] ?? '')) },
    '/api/machines/:id/eteindre': { POST: protege((req) => machine(d, req.params['id'] ?? '', 'eteindre')) },
    '/api/machines/:id/projets': { GET: protege((req) => machine(d, req.params['id'] ?? '', 'projets')) },
    '/api/machines/:id/comptes': { POST: protege((req) => d.comptes.connecter(req as never)) },
    '/api/machines/:id/comptes/relever': { POST: protege((req) => d.comptes.relever(req as never)) },
    '/api/machines/:id/comptes/:nom/code': { POST: protege((req) => d.comptes.code(req as never)) },
    '/api/machines/:id/comptes/:nom/retirer': { POST: protege((req) => d.comptes.retirer(req as never)) },
    '/api/artefacts': { GET: protege(() => d.artefacts.lister()) },
    '/api/sessions/:id/dossier': { GET: protege((req) => d.fichiersSession.arbre(req as never)) },
    '/api/sessions/:id/competences': { GET: protege((req) => d.fichiersSession.competences(req as never)) },
    '/api/sessions/:id/fichiers': { GET: protege((req) => d.fichiersSession.fichiers(req as never)) },
    '/api/sessions/:id/contenu': {
      GET: protege((req) => d.fichiersSession.lire(req as never)),
      PUT: protege((req) => d.fichiersSession.ecrire(req as never)),
    },
    '/api/sessions/:id/git/modifications': { GET: protege((req) => d.modifications.modifications(req as never)) },
    '/api/sessions/:id/git/diff': { GET: protege((req) => d.modifications.diff(req as never)) },
    '/api/sessions/:id/git/annuler': { POST: protege((req) => d.modifications.annuler(req as never)) },
    '/api/sessions/:id/git/commiter': { POST: protege((req) => d.modifications.commiter(req as never)) },
    '/api/sessions/:id/tours/:tour/modifications': {
      GET: protege((req) => d.modifications.tourModifications(req as never)),
    },
    '/api/sessions/:id/tours/:tour/diff': { GET: protege((req) => d.modifications.tourDiff(req as never)) },
    '/api/sessions/:id/tours/:tour/annuler': { POST: protege((req) => d.modifications.tourAnnuler(req as never)) },
    '/api/sessions/:id/artefacts/:artefact/renommer': { POST: protege((req) => d.artefacts.renommer(req as never)) },
    '/api/sessions/:id/artefacts/:artefact/dupliquer': { POST: protege((req) => d.artefacts.dupliquer(req as never)) },
    '/api/sessions/:id/artefacts/:artefact/supprimer': { POST: protege((req) => d.artefacts.supprimer(req as never)) },
    '/api/sessions/:id/artefacts/:artefact/epingler': { POST: protege((req) => d.artefacts.epingler(req as never)) },
    ...routesFichiers(d.fichiers, protege),
    ...routesEcho(d.echo, protege),
    ...routesReunions(d.reunions, protege),
  };
}

async function connexion(d: DependancesApi, req: Request, serveur: Serveur): Promise<Response> {
  const c = await lireCorps(req, CorpsConnexion);
  if (c instanceof Response) return c;
  const ip = ipDe(req, serveur.requestIP(req)?.address);
  const r = await d.acces.connecter(c.motDePasse, ip, c.appareil ?? req.headers.get('user-agent') ?? 'inconnu');
  if (!r.ok)
    return erreur(
      r.raison === 'trop_de_tentatives' ? 'trop de tentatives, réessaie plus tard' : 'mot de passe refusé',
      r.raison === 'trop_de_tentatives' ? 429 : 401,
    );
  return json({ jeton: r.jeton }, 200, { 'set-cookie': cookieDeSession(r.jeton) });
}

// `?archivees=1` : les sessions rangées reviennent dans la liste (absentes par défaut).
function avecArchivees(req: Request): boolean {
  return new URL(req.url).searchParams.get('archivees') === '1';
}

function etat(d: DependancesApi, req: Request) {
  const notifications = d.registre.notifications(0, 50);
  return {
    version: d.diffusion.version,
    machines: d.postes.vues(),
    sessions: d.registre.sessions(avecArchivees(req)),
    decouvertes: decouvertes(d),
    notifications,
    reveilPossible: [...d.wol.keys()],
  };
}

// Sessions des postes que le relais ne connaît pas encore (transcripts seuls) ; une fiche, même archivée, les retire.
function decouvertes(d: DependancesApi) {
  const connues = new Set<string>();
  for (const s of d.registre.sessions(true)) {
    connues.add(s.id);
    if (s.claudeSessionId) connues.add(s.claudeSessionId);
  }
  return d.postes.decouvertes(connues);
}

// Pour l'iPhone : une seule requête longue qui rend la main dès qu'il y a du nouveau (au-delà de `version`).
async function attente(d: DependancesApi, req: Request): Promise<Response> {
  const url = new URL(req.url);
  const version = entier(url.searchParams.get('version'), -1);
  const echeance = Date.now() + Math.min(entier(url.searchParams.get('attendre'), 25), 30) * 1000;
  while (d.diffusion.version <= version && Date.now() < echeance) await d.diffusion.attendre(echeance - Date.now());
  const apres = entier(url.searchParams.get('notifications'), 0);
  return json({
    version: d.diffusion.version,
    notifications: d.registre.notifications(apres),
    sessions: d.registre.sessions(avecArchivees(req)),
    decouvertes: decouvertes(d),
    machines: d.postes.vues(),
  });
}

async function marquerLues(d: DependancesApi, req: Request): Promise<Response> {
  const c = await lireCorps(req, z.object({ jusqua: z.number().int() }));
  if (c instanceof Response) return c;
  d.registre.marquerLues(c.jusqua);
  return json({ ok: true });
}

async function reveil(d: DependancesApi, id: string): Promise<Response> {
  const mac = d.wol.get(id);
  if (!mac) return erreur(`${id} ne se réveille pas à distance`, 404);
  try {
    await reveiller(mac, d.diffusionWol);
    return json({ ok: true });
  } catch (e) {
    return erreur(`réveil impossible : ${String(e)}`, 500);
  }
}

async function machine(d: DependancesApi, id: string, kind: 'eteindre' | 'projets'): Promise<Response> {
  const r = await d.postes.commander(id, { kind });
  return r.ok ? json(r.donnees ?? { ok: true }) : erreur(r.erreur ?? 'refusé', REFUS_POSTE);
}
