// Responsabilité : point d'entrée du relais — deux serveurs : clients (web, iPhone) et postes (machines de travail).
import { creerJournal } from '../commun/journal.ts';
import { CHEMIN_POSTE } from '../commun/protocole-poste.ts';
import { Acces, PROTOCOLE_FLUX } from './acces/acces.ts';
import { PlafondEchecs } from './acces/plafond.ts';
import { construireRoutes } from './clients/api.ts';
import { routesAcces } from './acces/api-acces.ts';
import { adresseBoucle, routesMcp } from './connecteurs/mcp-http.ts';
import { ApiFichiers } from './appareils/api-fichiers.ts';
import { ouvrirTerminal } from './appareils/route-terminal.ts';
import { type DonneesTerminal, estTerminal, TerminauxRelais } from './appareils/terminaux.ts';
import { ApiComptes } from './clients/api-comptes.ts';
import { ApiSessions } from './clients/api-sessions.ts';
import { routesHq } from './clients/hq.ts';
import { indexSpa, servirStatique } from './clients/statique.ts';
import { avecCors } from './clients/cors.ts';
import { Diffusion } from './clients/diffusion.ts';
import { LienEcho } from './echo/lien-echo.ts';
import { erreur } from './clients/http.ts';
import { chargerConfig } from './config.ts';
import { type DonneesPoste, Postes } from './parc/postes.ts';
import { ouvrirBase } from './registre/base.ts';
import { Registre } from './registre/registre.ts';
import { lancerRetention } from './registre/retention.ts';
import { lancerRecalculInactivite } from './sessions/recalcul-inactivite.ts';

const journal = creerJournal('relais');
const config = chargerConfig();
const registre = new Registre(ouvrirBase(config.base), journal, config.inactiviteMs);
const diffusion = new Diffusion();
const plafond = new PlafondEchecs(config.fichierEchecs, journal.child({ domaine: 'acces' }));
const acces = new Acces(registre, config.empreinteMotDePasse, plafond);
const postes = new Postes(registre, diffusion, config.secretsPostes, journal);
const sessions = new ApiSessions(registre, postes, diffusion, config.isolees, journal);
const comptes = new ApiComptes(postes, journal);
const fichiers = new ApiFichiers(postes, journal);
const terminaux = new TerminauxRelais(postes, journal);
postes.terminaux = terminaux;
const echo = config.echo
  ? new LienEcho(config.echo.url, config.echo.jeton, diffusion, journal.child({ domaine: 'echo' }))
  : null;
echo?.demarrer();
type DonneesClient = { readonly type: 'flux' } | DonneesTerminal;
const routes = avecCors(
  construireRoutes({
    acces,
    registre,
    postes,
    diffusion,
    sessions,
    comptes,
    fichiers,
    echo,
    wol: config.wol,
    diffusionWol: config.diffusionWol,
  }),
  config.origines,
);
const routesGestionAcces = avecCors(routesAcces(acces, journal.child({ domaine: 'acces' })), config.origines);
const connecteurs = routesMcp(
  acces,
  adresseBoucle(config.hotesWeb[0] ?? '127.0.0.1', config.portWeb),
  journal.child({ domaine: 'mcp' }),
);

// L'interface de bureau, servie à la racine : fichier exact, sinon index.html (repli SPA).
function fichierBureau(req: Request): Response {
  return servirStatique(config.web, new URL(req.url).pathname) ?? indexSpa(config.web);
}

for (const hostname of config.hotesWeb) {
  Bun.serve({
    hostname,
    port: config.portWeb,
    // Au-delà des 10 s par défaut : le long-poll attend jusqu'à 30 s, une commande de poste jusqu'à 60 s.
    idleTimeout: 75,
    routes: {
      ...routes,
      ...routesGestionAcces,
      ...connecteurs,
      ...routesHq(config.hq, (req) => acces.autorise(req)),
      '/api/flux': (req, serveur) => {
        if (!acces.autorise(req)) return erreur('non connecté', 401);
        const parProtocole = (req.headers.get('sec-websocket-protocol') ?? '').startsWith(PROTOCOLE_FLUX);
        const data: DonneesClient = { type: 'flux' };
        // Jamais `headers: {}` : upgrade() de Bun plante dessus (500 pour un client authentifié par en-tête).
        const options = parProtocole ? { data, headers: { 'Sec-WebSocket-Protocol': PROTOCOLE_FLUX } } : { data };
        return serveur.upgrade(req, options) ? undefined : erreur('WebSocket attendu', 426);
      },
      '/api/terminal': (req, serveur) => ouvrirTerminal(req, serveur, acces, postes),
      '/api/*': () => erreur('route inconnue', 404),
    },
    fetch: fichierBureau,
    websocket: {
      data: {} as DonneesClient,
      open: (ws) => (estTerminal(ws) ? void terminaux.ouvert(ws) : diffusion.ajouter(ws)),
      close: (ws) => (estTerminal(ws) ? terminaux.ferme(ws) : diffusion.retirer(ws)),
      // Le flux : les clients écoutent et agissent par l'API HTTP. Un terminal : la frappe et les redimensionnements.
      message: (ws, m) => (estTerminal(ws) ? terminaux.recu(ws, m) : undefined),
      idleTimeout: 120,
      sendPings: true,
    },
  });
}

Bun.serve({
  port: config.portPostes,
  fetch(req, serveur) {
    if (new URL(req.url).pathname !== CHEMIN_POSTE) return new Response('introuvable', { status: 404 });
    const machine = postes.authentifier(req);
    if (!machine) {
      journal.warn({ machine: req.headers.get('x-ccremote-machine') }, 'poste refusé : secret invalide');
      return new Response('refusé', { status: 401 });
    }
    return serveur.upgrade(req, { data: { machine } }) ? undefined : new Response('WebSocket attendu', { status: 426 });
  },
  websocket: {
    data: {} as DonneesPoste,
    open: (ws) => postes.ouvert(ws),
    close: (ws) => postes.ferme(ws),
    message: (ws, m) => postes.recu(ws, String(m)),
    idleTimeout: 120,
    sendPings: true,
    maxPayloadLength: 16 * 1024 * 1024, // un morceau de fichier : 4 Mo bruts, ~5,4 Mo en base64
  },
});

lancerRetention(registre, journal);
lancerRecalculInactivite(registre, diffusion, journal.child({ domaine: 'sessions' }));

journal.info(
  {
    web: config.portWeb,
    hotesWeb: config.hotesWeb,
    postes: config.portPostes,
    machinesAutorisees: [...config.secretsPostes.keys()],
  },
  'relais démarré',
);
