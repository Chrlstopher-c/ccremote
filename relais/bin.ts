// Responsabilité : point d'entrée du relais — deux serveurs : clients (web, iPhone) et postes (machines de travail).
import { dirname, join } from 'node:path';
import { creerJournal } from '../commun/journal.ts';
import { COMMIT, VERSION } from '../commun/version.ts';
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
import { ReleveUsage } from './usage/releves-usage.ts';
import { ApiSessions } from './clients/api-sessions.ts';
import { ApiSessionConfig } from './clients/api-session-config.ts';
import { ApiConfiguration } from './clients/api-configuration.ts';
import { routesHq } from './clients/hq.ts';
import { indexSpa, servirStatique } from './clients/statique.ts';
import { avecCors } from './clients/cors.ts';
import { Diffusion } from './clients/diffusion.ts';
import { AppelsModules } from './modules/appels.ts';
import { LienEcho } from './echo/lien-echo.ts';
import { erreur } from './clients/http.ts';
import { chargerConfig } from './config.ts';
import { type DonneesPoste, Postes } from './parc/postes.ts';
import { DesktopDesPostes } from './parc/desktop-postes.ts';
import { ArchivagesDesktop } from './registre/archivages-desktop.ts';
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
import { ApiEntretien } from './entretien/api-entretien.ts';
import { ApiReste } from './reste/api-reste.ts';
import { ApiDictee } from './reste/api-dictee.ts';
import { ApiResteSessions } from './reste/api-reste-sessions.ts';
import { ApiParite } from './parite/api-parite.ts';
import { ApiTaches } from './reste/api-taches.ts';
import { ReseauxConnus } from './entretien/reseaux.ts';
import { Reveil } from './entretien/reveil.ts';
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
const appelsModules = new AppelsModules({ registre, diffusion });
postes.desktop = new DesktopDesPostes(new ArchivagesDesktop(base));
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
          .map((c) => ({
            id: c.id,
            connexion: { hote: c.hote, port: c.port, utilisateur: c.utilisateur, cle: c.cle },
            portDistant: c.portDistant,
          })),
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
const ssh = new Ssh(undefined, journal.child({ domaine: 'ssh' }));
const machines = new ApiMachines({
  registre: registreMachines,
  postes,
  ssh,
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
// Entretien : le dernier réseau de chaque machine (réveil), les gestes de l'entretien et le réveil délégué.
const reseaux = new ReseauxConnus(join(dirname(config.base), 'reveil.json'), journal.child({ domaine: 'reveil' }));
postes.reseauRecu = (id, reseau) => reseaux.retenir(id, reseau);
const reveil = new Reveil({
  wol: config.wol,
  diffusionWol: config.diffusionWol,
  reseaux,
  envoyerPar: (poste, envoi) =>
    postes.commander(poste, { kind: 'reveiller', mac: envoi.mac, diffusion: envoi.diffusion }),
  factice: process.env['CCREMOTE_REVEIL_FACTICE'] || undefined,
  journal: journal.child({ domaine: 'reveil' }),
});
const entretien = new ApiEntretien({
  postes,
  machines,
  registre: registreMachines,
  ssh,
  tunnels,
  reveil,
  locale: process.env['CCREMOTE_MACHINE_LOCALE'] || null,
  relais: { version: VERSION, commit: COMMIT },
  journal: journal.child({ domaine: 'entretien' }),
});
const reste = new ApiReste({ registre, postes, journal: journal.child({ domaine: 'reste' }) });
const resteLot2 = {
  sessions: new ApiResteSessions({ registre, postes, journal: journal.child({ domaine: 'reste' }) }),
  dictee: new ApiDictee({ postes, journal: journal.child({ domaine: 'dictee' }) }),
  taches: new ApiTaches({ postes, journal: journal.child({ domaine: 'taches' }) }),
};
const parite = new ApiParite({ registre, postes, journal: journal.child({ domaine: 'parite' }) });
const sessions = new ApiSessions(registre, postes, diffusion, config.isolees, journal);
const sessionConfig = new ApiSessionConfig(registre, postes);
const configuration = new ApiConfiguration(postes, journal.child({ domaine: 'configuration' }));
// Un seul relevé d'usage par compte réel du parc : le relais choisit le poste, cadence et garde la dernière valeur.
const usage = new ReleveUsage(base, registre, postes, journal.child({ domaine: 'usage' }), () => {
  for (const m of registre.machines()) postes.rafraichirMachine(m.id);
});
registre.surFusionComptes((c) => usage.appliquer(c));
postes.surCompteLimite((_machine, cle, limite) => usage.recevoirLimite(cle, limite));
void usage.tick();
setInterval(() => void usage.tick(), 60_000);
const comptes = new ApiComptes(postes, journal, usage);
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
    machines,
    entretien,
    reste,
    resteLot2,
    parite,
    confirmations,
    appels: appelsModules,
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
        ouvrirTerminalSession(
          req,
          serveur,
          acces,
          postes,
          registre,
          (req as Request & { params: Record<string, string> }).params['id'] ?? '',
        ),
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
    maxPayloadLength: 64 * 1024 * 1024, // un module de 20 Mo part en base64 (~27 Mo) dans un seul message (v1.2)
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
