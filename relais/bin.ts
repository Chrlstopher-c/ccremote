// Responsabilité : point d'entrée du relais — deux serveurs : clients (web, iPhone) et postes (machines de travail).
import { join } from 'node:path';
import { creerJournal } from '../commun/journal.ts';
import { CHEMIN_POSTE } from '../commun/protocole-poste.ts';
import { Acces, PROTOCOLE_FLUX } from './acces/acces.ts';
import { PlafondEchecs } from './acces/plafond.ts';
import { construireRoutes } from './clients/api.ts';
import { routesAcces } from './acces/api-acces.ts';
import { adresseBoucle, routesMcp } from './connecteurs/mcp-http.ts';
import { ApiFichiers } from './appareils/api-fichiers.ts';
import { ApiArtefacts } from './clients/api-artefacts.ts';
import { ApiModifications } from './clients/api-modifications.ts';
import { ouvrirTerminal, ouvrirTerminalSession } from './appareils/route-terminal.ts';
import { ApiFichiersSession } from './clients/api-fichiers-session.ts';
import { type DonneesTerminal, estTerminal, TerminauxRelais } from './appareils/terminaux.ts';
import { ApiComptes } from './clients/api-comptes.ts';
import { ApiSessions } from './clients/api-sessions.ts';
import { ApiSessionConfig } from './clients/api-session-config.ts';
import { ApiConfiguration } from './clients/api-configuration.ts';
import { routesHq } from './clients/hq.ts';
import { indexSpa, servirStatique } from './clients/statique.ts';
import { avecCors } from './clients/cors.ts';
import { Diffusion } from './clients/diffusion.ts';
import { LienEcho } from './echo/lien-echo.ts';
import { erreur } from './clients/http.ts';
import { chargerConfig } from './config.ts';
import { type DonneesPoste, Postes } from './parc/postes.ts';
import { ApiMachines } from './machines/api-machines.ts';
import { ApiConfirmations } from './machines/api-confirmations.ts';
import { Confirmations } from './machines/confirmations.ts';
import { AccesMachines } from './machines/acces-machines.ts';
import { Installations } from './machines/installations.ts';
import { RegistreMachines } from './machines/registre-machines.ts';
import { nommageLanterne } from './machines/script-installation.ts';
import { chargerSecretsPostes, dossierSecretsPostes } from './machines/secrets.ts';
import { Ssh } from './machines/ssh.ts';
import { Tunnels } from './machines/tunnels.ts';
import { ouvrirBase } from './registre/base.ts';
import { Registre } from './registre/registre.ts';
import { lancerRetention } from './registre/retention.ts';
import { lancerRecalculInactivite } from './sessions/recalcul-inactivite.ts';
import { RegistreReunions } from './reunion/registre-reunions.ts';
import { SalleDeReunion } from './reunion/salle.ts';

const journal = creerJournal('relais');
const config = chargerConfig();
const base = ouvrirBase(config.base);
const registre = new Registre(base, journal, config.inactiviteMs);
const diffusion = new Diffusion();
const plafond = new PlafondEchecs(config.fichierEchecs, journal.child({ domaine: 'acces' }));
const acces = new Acces(registre, config.empreinteMotDePasse, plafond);
const dossierSecrets = dossierSecretsPostes();
const secretsPostes = new Map<string, string>([...config.secretsPostes, ...chargerSecretsPostes(dossierSecrets)]);
const postes = new Postes(registre, diffusion, secretsPostes, journal);
const confirmations = new ApiConfirmations(new Confirmations((m) => diffusion.diffuser(m)));
// Relais intégré (appli) : les postes Lanterne sont joints par des tunnels SSH inverses lancés d'ici.
const integre = config.integre;
const registreMachines = new RegistreMachines(base);
const tunnels = integre
  ? new Tunnels({
      cibles: () =>
        registreMachines
          .lister()
          .filter((c) => secretsPostes.has(c.id))
          .map((c) => ({ id: c.id, connexion: { hote: c.hote, port: c.port, utilisateur: c.utilisateur, cle: c.cle }, portDistant: c.portDistant })),
      portPostes: config.portPostes,
      surChangement: (id) => postes.rafraichirMachine(id),
      journal: journal.child({ domaine: 'tunnels' }),
    })
  : null;
const installations = new Installations({ surChangement: (id) => postes.rafraichirMachine(id) });
const accesMachines = integre
  ? new AccesMachines({
      configurations: () => registreMachines.lister(),
      installee: (id) => secretsPostes.has(id),
      tunnel: (id) => tunnels?.etat(id) ?? { ouvert: false, detail: null },
      enLigne: (id) => postes.enLigne(id),
      connue: (id) => registre.machines().some((m) => m.id === id),
      installation: (id) => installations.de(id),
    })
  : null;
postes.acces = accesMachines;
const machines = new ApiMachines({
  registre: registreMachines,
  postes,
  ssh: new Ssh(undefined, journal.child({ domaine: 'ssh' })),
  secrets: secretsPostes,
  dossierSecrets,
  relaisPostes: config.relaisPostes,
  acces,
  urlApi: config.urlApiPostes,
  racineCode: join(import.meta.dir, '..'),
  journal: journal.child({ domaine: 'machines' }),
  integre:
    integre && config.integre
      ? {
          nommage: nommageLanterne(integre.instance),
          portDistantDefaut: integre.portDistantDefaut,
          codePoste: integre.codePoste,
        }
      : undefined,
  tunnels: tunnels ?? undefined,
  installations,
});
postes.miseAJour = integre ? (id, empreinte) => machines.surConnexion(id, empreinte) : null;
if (tunnels) {
  tunnels.synchroniser();
  // À l'arrêt du relais, les tunnels ssh partent avec lui (sans relance).
  process.once('exit', () => tunnels.arreterTout());
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => process.exit(0));
  }
}
const sessions = new ApiSessions(registre, postes, diffusion, config.isolees, journal);
const sessionConfig = new ApiSessionConfig(registre, postes);
const configuration = new ApiConfiguration(postes, journal.child({ domaine: 'configuration' }));
const comptes = new ApiComptes(postes, journal);
const fichiers = new ApiFichiers(postes, journal);
const artefacts = new ApiArtefacts(registre, postes, journal);
const modifications = new ApiModifications(registre, postes, journal);
const fichiersSession = new ApiFichiersSession(registre, postes, journal);
const terminaux = new TerminauxRelais(postes, journal);
postes.terminaux = terminaux;
const salleReunions = new SalleDeReunion({
  reunions: new RegistreReunions(base),
  registre,
  postes,
  diffusion,
  journal: journal.child({ domaine: 'reunion' }),
  limite: config.reunionLimite,
});
postes.reunions = salleReunions;
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
    sessionConfig,
    configuration,
    comptes,
    fichiers,
    artefacts,
    modifications,
    fichiersSession,
    echo,
    reunions: { salle: salleReunions, journal: journal.child({ domaine: 'reunion' }) },
    wol: config.wol,
    diffusionWol: config.diffusionWol,
    machines,
    confirmations,
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
      ...routesHq(config.hq),
      '/api/flux': (req, serveur) => {
        if (!acces.autorise(req)) return erreur('non connecté', 401);
        const parProtocole = (req.headers.get('sec-websocket-protocol') ?? '').startsWith(PROTOCOLE_FLUX);
        const data: DonneesClient = { type: 'flux' };
        // Jamais `headers: {}` : upgrade() de Bun plante dessus (500 pour un client authentifié par en-tête).
        const options = parProtocole ? { data, headers: { 'Sec-WebSocket-Protocol': PROTOCOLE_FLUX } } : { data };
        return serveur.upgrade(req, options) ? undefined : erreur('WebSocket attendu', 426);
      },
      '/api/terminal': (req, serveur) => ouvrirTerminal(req, serveur, acces, postes),
      '/api/sessions/:id/terminal': (req, serveur) =>
        ouvrirTerminalSession(req, serveur, acces, postes, registre, (req as Request & { params: Record<string, string> }).params['id'] ?? ''),
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
  hostname: config.hotePostes,
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
