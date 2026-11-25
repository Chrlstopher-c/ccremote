// Responsabilité : point d'entrée du relais — deux serveurs : clients (web, iPhone) et postes (machines de travail).
import { hostname, userInfo } from 'node:os';
import { dirname, join } from 'node:path';
import { creerJournal } from '../commun/journal.ts';
import { COMMIT, VERSION } from '../commun/version.ts';
import { Acces, PROTOCOLE_FLUX } from './acces/acces.ts';
import { PlafondEchecs } from './acces/plafond.ts';
import { avecGardeInvites, construireRoutes, type DependancesApi } from './clients/api.ts';
import type { GesteLocal } from './federation/echanges.ts';
import { ApiInvites } from './invites/api-invites.ts';
import { executerGeste, type TableInterne } from './federation/executeur.ts';
import { servirAppareil } from './federation/appareils.ts';
import { ApiVoix, urlVoix } from './voix/api-voix.ts';
import { routesAcces } from './acces/api-acces.ts';
import type { PosteRelais } from './acces/api-appairage.ts';
import { adresseBoucle, routesMcp } from './connecteurs/mcp-http.ts';
import { lireJetonFichier } from '../poste/comptes/lecture-compte.ts';
import { PREFIXE_ROUTE_CLAUDE } from './invites/relais-claude-client.ts';
import { ApiFichiers } from './appareils/api-fichiers.ts';
import { ApiArtefacts } from './clients/api-artefacts.ts';
import { ApiModifications } from './clients/api-modifications.ts';
import { ouvrirTerminal, ouvrirTerminalSession } from './appareils/route-terminal.ts';
import { ApiFichiersSession } from './clients/api-fichiers-session.ts';
import { type DonneesTerminal, estTerminal, TerminauxRelais } from './appareils/terminaux.ts';
import { type DonneesTerminalFedere, estTerminalFedere } from './federation/terminal-federe.ts';
import { ApiComptes } from './clients/api-comptes.ts';
import { ReleveUsage } from './usage/releves-usage.ts';
import { ApiSessions } from './clients/api-sessions.ts';
import { ApiSessionConfig } from './clients/api-session-config.ts';
import { ReglageExtinctionAuto } from './sessions/extinction-auto-reglage.ts';
import { lancerExtinctionAuto } from './sessions/extinction-auto.ts';
import { ApiConfiguration } from './clients/api-configuration.ts';
import { routesHq } from './clients/hq.ts';
import { indexSpa, servirStatique } from './clients/statique.ts';
import { avecCors } from './clients/cors.ts';
import { Diffusion } from './clients/diffusion.ts';
import { AppelsModules } from './modules/appels.ts';
import { appelerLocalPair, traiterRequeteRelais } from './modules/api-appels.ts';
import { type DependancesOutilsParc, estOperationParc, traiterRequeteParc } from './parc/outils-parc.ts';
import { LienEcho } from './echo/lien-echo.ts';
import { erreur } from './clients/http.ts';
import { chargerConfig } from './config.ts';
import { Postes } from './parc/postes.ts';
import { demarrerEcoutePostes } from './ecoute-postes.ts';
import { DesktopDesPostes } from './parc/desktop-postes.ts';
import { ArchivagesDesktop } from './registre/archivages-desktop.ts';
import { ApiMachines } from './machines/api-machines.ts';
import { ApiConfirmations } from './machines/api-confirmations.ts';
import { Confirmations } from './machines/confirmations.ts';
import { AccesMachines } from './machines/acces-machines.ts';
import { Installations } from './machines/installations.ts';
import { RegistreMachines } from './machines/registre-machines.ts';
import { nommageLanterne } from './machines/script-installation.ts';
import { chargerSecretsPostes } from './machines/secrets.ts';
import { Ssh } from './machines/ssh.ts';
import { Tunnels } from './machines/tunnels.ts';
import { ApiEntretien } from './entretien/api-entretien.ts';
import { ApiReste } from './reste/api-reste.ts';
import { ApiDictee } from './reste/api-dictee.ts';
import { ApiServiceVoix } from './reste/api-voix-service.ts';
import { ApiResteSessions } from './reste/api-reste-sessions.ts';
import { ApiParite } from './parite/api-parite.ts';
import { ApiTaches } from './reste/api-taches.ts';
import { ReseauxConnus } from './entretien/reseaux.ts';
import { Reveil } from './entretien/reveil.ts';
import { compacterPeu, ouvrirBase } from './registre/base.ts';
import { sondesFonctions } from './federation/sondes-fonctions.ts';
import { Registre } from './registre/registre.ts';
import { lancerRetention } from './registre/retention.ts';
import { lancerRecalculInactivite } from './sessions/recalcul-inactivite.ts';
import { RegistreReunions } from './reunion/registre-reunions.ts';
import { SalleDeReunion } from './reunion/salle.ts';
import { AmisDuo } from './duo/amis.ts';
import { Federation } from './federation/federation.ts';
import { SecretsNoeud } from './federation/secrets.ts';
import { CodesReseau } from './codes-reseau/codes-reseau.ts';
import { creerAjoutNoeud } from './ajout-noeud/brancher.ts';
import { JournalSynchro } from './synchro/journal.ts';
import { ServiceSynchro } from './synchro/service.ts';
import { nomUtilisateur } from '../commun/identite.ts';
import { demarrerAiguilleur } from './aiguilleur/demarrer.ts';
import { DELAI_RAFRAICHISSEMENT_MS, lancerClaudeMinimal, RafraichisseurJeton } from './invites/rafraichir-jeton.ts';
import { trouverClaude } from '../poste/session/session-sdk.ts';

// Mode aiguilleur (même binaire) : annuaire et liens seulement. Le reste de ce fichier, qui ouvre le relais complet,
// n'est pas lancé ; le service vit par les serveurs démarrés ici.
if (process.env['LANTERNE_RELAIS_MODE'] === 'aiguilleur') {
  demarrerAiguilleur();
  await new Promise<never>(() => undefined);
}

const journal = creerJournal('relais');
// Un jeton qui expire dans moins de 2 min est traité comme expiré : Claude Code le renouvelle avant de relayer.
const MARGE_JETON_MS = 120_000;
const rafraichisseurJeton = new RafraichisseurJeton({
  journal: journal.child({ domaine: 'relais-claude' }),
  delaiMs: DELAI_RAFRAICHISSEMENT_MS,
  lancer: () => lancerClaudeMinimal(trouverClaude() ?? 'claude'),
});
// Jeton du compte Claude par défaut de cette machine (relais des invités) ; illisible ou absent : aucun relais.
function jetonDuCompteParDefaut(): string | null {
  try {
    return lireJetonFichier(null, MARGE_JETON_MS);
  } catch (erreur) {
    journal.warn({ err: erreur }, 'jeton du compte Claude illisible : relais des invités indisponible');
    return null;
  }
}
const config = chargerConfig();
const base = ouvrirBase(config.base);
const registre = new Registre(base, journal, config.inactiviteMs);
const diffusion = new Diffusion();
const plafond = new PlafondEchecs(config.fichierEchecs, journal.child({ domaine: 'acces' }));
const acces = new Acces(registre, config.empreinteMotDePasse, plafond);
const dossierSecrets = config.dossierSecrets;
const secretsPostes = new Map<string, string>([...config.secretsPostes, ...chargerSecretsPostes(dossierSecrets)]);
const postes = new Postes(registre, diffusion, secretsPostes, journal);
const appelsModules = new AppelsModules({
  registre,
  diffusion,
  pairs: { relayer: (demande, delai) => federation.relayerAppel(demande, delai) },
});
postes.desktop = new DesktopDesPostes(new ArchivagesDesktop(base));
postes.reconcilierDoublons();
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
  dictee: new ApiDictee({
    postes,
    pairs: {
      dicteeServiceDesPairs: () => federation.distantes.dicteeServiceDesPairs(),
      membreDeMachine: (machine) => federation.distantes.membreDeMachine(machine),
      transcrireChez: (membre, corps) => federation.distantes.transcrireChez(membre, corps),
    },
    journal: journal.child({ domaine: 'dictee' }),
  }),
  taches: new ApiTaches({ postes, journal: journal.child({ domaine: 'taches' }) }),
  voix: new ApiServiceVoix({
    postes,
    pairs: { voixServiceDesPairs: () => federation.distantes.voixServiceDesPairs() },
    journal: journal.child({ domaine: 'voix' }),
  }),
};
const parite = new ApiParite({ registre, postes, journal: journal.child({ domaine: 'parite' }) });
// Mode duo : deux relais reliés par le lien (appairage, partages, présence, échanges). Écoute à part, jamais sur les
// clients. Les sessions du pair passent par ApiSessions (même chemin qu'une commande de Chris).
const duo: AmisDuo = new AmisDuo({
  registre,
  diffusion,
  base,
  utilisateur: nomUtilisateur(process.env, userInfo().username),
  dossierSecrets,
  ecoute: config.duo.ecoute,
  port: config.duo.port,
  journal: journal.child({ domaine: 'duo' }),
  postes,
  sessions: {
    ouvrir: (demande) => sessions.ouvrirAvec(demande),
    envoyer: (session, texte, pieces, auteur) => sessions.envoyerDuPair(session, texte, pieces, auteur),
    interrompre: (session) => sessions.interrompreDuPair(session),
    tracer: (session, trace) => sessions.tracerDuPair(session, trace),
  },
});
const machineLocale = process.env['CCREMOTE_MACHINE_LOCALE'] || hostname();
const sessions: ApiSessions = new ApiSessions(registre, postes, diffusion, config.isolees, journal, duo, (machine) =>
  machine === machineLocale ? federation.compteChoisi() : null,
);
// Fédération « mes machines » : inerte tant que ce nœud n'est pas relié à un aiguilleur (le mode tunnel reste le défaut).
const federation = new Federation({
  registre,
  diffusion,
  dossierSecrets,
  // Relais Claude : le compte Claude de cette machine sert les requêtes relayées des invités (jamais exposé).
  jetonAbonnement: () => jetonDuCompteParDefaut(),
  rafraichirJeton: () => rafraichisseurJeton.rafraichir(),
  servirAppareil: (demande) => servirPourAppareil(demande),
  servirChef: (demande) => servirPourChef(demande),
  fonctions: sondesFonctions(process.env, journal.child({ domaine: 'fonctions' })),
  machine: machineLocale,
  peutReprendre: process.env['LANTERNE_MOTEUR_AUTONOME'] !== '1',
  pont: {
    ouvrir: (demande) => sessions.ouvrirAvec(demande),
    envoyer: (session, texte) => sessions.envoyerDuPair(session, texte, []),
    interrompre: (session) => sessions.interrompreDuPair(session),
    geste: (g: GesteLocal): Promise<Response> =>
      g.invite
        ? federation.invites.executerOuverture(g, (c, cadre) => sessions.ouvrirAvec(c, cadre))
        : executerGeste(routesInternes, g),
  },
  notifier: (titre, texte) => notifierChris(titre, texte),
  reseaux,
  reveil,
  postesEnLigne: () => postes.vues().filter((v) => v.enLigne).map((v) => v.id),
  journal: journal.child({ domaine: 'federation' }),
});
// Codes d'appairage demandés par l'appli (même propriétaire, invitation en duo) : relayés à l'aiguilleur de ce nœud.
const secretsNoeud = new SecretsNoeud(dossierSecrets, journal);
const codesReseau = new CodesReseau(secretsNoeud, journal.child({ domaine: 'codes' }));
// Ajouter une machine au réseau (Paramètres › Réseau) : installation du nœud par SSH, appairage, reprise d'attribution.
const ajoutNoeud = creerAjoutNoeud({
  ssh,
  machines: registreMachines,
  federation,
  codes: codesReseau,
  registre,
  diffusion,
  codePoste: integre?.codePoste ?? null,
  journal: journal.child({ domaine: 'ajout-noeud' }),
});
// Le duo passe par ce même lien (un seul par nœud) : ses canaux `duo-…` lui sont remis.
federation.brancherDuo(duo.brancherAiguilleur(federation.portDuo()));
diffusion.filtre = (m) => federation.distantes.laisserPasser(m);
federation.demarrer();
process.once('exit', () => federation.arreter());
// Synchronisations sur demande (étape 6) : le journal reste dans le dossier du nœud, jamais de contenu de session.
const synchro = new ServiceSynchro({
  registre,
  diffusion,
  lien: {
    identifiant: () => federation.identifiantLocal(),
    envoyer: (membre, message) => federation.envoyerSynchro(membre, message),
  },
  journal: new JournalSynchro(join(dossierSecrets, 'synchro-journal.json'), journal.child({ domaine: 'synchro' })),
  logger: journal.child({ domaine: 'synchro' }),
  surDemandeRecue: (d) =>
    notifierChris(
      'Demande de synchronisation',
      `Une de tes machines demande : ${d.quoi.join(', ')}. Paramètres › Réseau.`,
    ),
});
federation.brancherSynchro((membre, brut) => synchro.recevoir(membre, brut));
process.once('exit', () => synchro.arreter());
const sessionConfig = new ApiSessionConfig(registre, postes, diffusion);
// Outils du parc (sessions hors de Lanterne) et outils de modules : deux familles, un seul lien poste ↔ relais.
const outilsParc: DependancesOutilsParc = {
  postes,
  registre,
  sessions,
  entretien,
  journal: journal.child({ domaine: 'outils-parc' }),
};
postes.requetes.surRequete = (quoi, args) =>
  estOperationParc(quoi) ? traiterRequeteParc(outilsParc, quoi, args) : traiterRequeteRelais(appelsModules, quoi, args);
const configuration = new ApiConfiguration(postes, journal.child({ domaine: 'configuration' }));
// Un seul relevé d'usage par compte réel du parc : le relais choisit le poste, cadence et garde la dernière valeur.
const usage = new ReleveUsage(base, registre, postes, journal.child({ domaine: 'usage' }), () => {
  for (const m of registre.machines()) postes.rafraichirMachine(m.id);
});
registre.surFusionComptes((c) => usage.appliquer(c));
postes.surCompteLimite((_machine, cle, limite) => usage.recevoirLimite(cle, limite));
void usage.tick();
setInterval(() => void usage.tick(), 60_000);
const extinctionAuto = new ReglageExtinctionAuto(base);
lancerExtinctionAuto({
  reglage: extinctionAuto,
  registre,
  postes,
  journal: journal.child({ domaine: 'sessions' }),
});
// Pages vides rendues au disque par petits morceaux (base en compactage continu, voir base.ts).
setInterval(() => {
  try {
    compacterPeu(base);
  } catch (erreur) {
    journal.warn({ err: erreur }, 'compactage continu de la base en échec');
  }
}, 10 * 60_000);
const comptes = new ApiComptes(postes, journal, usage);
const fichiers = new ApiFichiers(postes, journal);
const artefacts = new ApiArtefacts(registre, postes, journal);
const modifications = new ApiModifications(registre, postes, journal);
const fichiersSession = new ApiFichiersSession(registre, postes, journal);
const terminaux = new TerminauxRelais(postes, journal);
federation.terminaux.brancher(terminaux);
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
type DonneesClient = { readonly type: 'flux' } | DonneesTerminal | DonneesTerminalFedere;
// Les invités : ouverture par la politique, routes des réglages et de l'activité (relais/invites).
const invitesApi = new ApiInvites({
  invites: federation.invites,
  charte: () => federation.charte.charte(),
  moi: () => federation.charte.moi(),
  chefLocal: () => federation.charte.chefLocal(),
  editer: (fn) => federation.charte.editer(fn),
  appairer: (membre) => federation.appairer(membre),
  ouvrirAvec: (c, cadre) => sessions.ouvrirAvec(c, cadre),
  relaisLocal: () => ({
    url: `${adresseBoucle(config.boucleWeb.hote, config.boucleWeb.port)}${PREFIXE_ROUTE_CLAUDE}`,
    jeton: federation.relais.jetonRelais(),
  }),
  commander: (machine, commande) => postes.commander(machine, commande),
  session: (id) => registre.session(id),
  repli: (req) => sessions.ouvrir(req),
  codes: codesReseau,
});
const dependancesApi: DependancesApi = {
  extinctionAuto,
  invites: invitesApi,
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
  duo,
  federation,
  codesReseau,
  secretsNoeud,
  ajoutNoeud,
  synchro,
  voix: new ApiVoix(urlVoix(process.env), federation.distantes, journal.child({ domaine: 'voix' })),
};
const routes = avecCors(construireRoutes(dependancesApi), config.origines);
// Table interne (sans jeton) : seuls les gestes relayés par un nœud apparié, sur le lien chiffré, y passent.
// Les valeurs de la table sont les gestionnaires par méthode de Bun.serve : même forme que TableInterne.
// `modules/appel-pair` : l'appel relayé par un pair, exécuté par les applis de ce nœud seulement (jamais relayé).
const routesInternes = {
  ...construireRoutes(dependancesApi, (g) => g),
  '/api/modules/appel-pair': { POST: (req: Request) => appelerLocalPair(appelsModules, req) },
} as unknown as TableInterne;
// Les appareils lisent les routes locales : la garde des invités s'y applique (le pair, lui, passe par la politique).
// Pas de relais ici : l'appareil parle directement au nœud qui tient la session (réseau v3 §7), il n'a pas à passer
// par un autre nœud. Une session d'un autre nœud, demandée ici, reçoit la copie locale (ou rien) : c'est voulu.
const routesAppareils = construireRoutes(dependancesApi, (g) => avecGardeInvites(dependancesApi, g)) as unknown as TableInterne;
// Un appareil appairé (identité acceptée au nœud) : son API passe par la table interne, sur son canal chiffré.
const servirPourAppareil = servirAppareil(routesAppareils, journal.child({ domaine: 'appareil' }));
const servirPourChef = servirAppareil(routesInternes, journal.child({ domaine: 'chef' }), { toutesRoutes: true });
federation.distantes.brancherMachines(() => postes.vues());

// Une demande qui attend la décision de Chris sur ce nœud (appairage, synchronisation) : notification dans l'appli.
function notifierChris(titre: string, texte: string): void {
  const notification = registre.ajouterNotification({
    sessionId: null,
    niveau: 'important',
    titre,
    texte,
    ts: new Date().toISOString(),
  });
  diffusion.diffuser({ type: 'notification', notification });
}
// Appairage avec machine : le relais central remet le lien des postes et le jeton (table partagée avec les postes).
const posteRelais: PosteRelais | null = config.central
  ? { dossier: dossierSecrets, secrets: secretsPostes, urlPoste: config.urlPoste, couper: (m) => postes.couper(m) }
  : null;
const routesGestionAcces = avecCors(
  routesAcces(acces, journal.child({ domaine: 'acces' }), posteRelais),
  config.origines,
);
const connecteurs = routesMcp(
  acces,
  adresseBoucle(config.boucleWeb.hote, config.boucleWeb.port),
  journal.child({ domaine: 'mcp' }),
);

// L'interface de bureau, servie à la racine : fichier exact, sinon index.html (repli SPA).
function fichierBureau(req: Request): Response {
  return servirStatique(config.web, new URL(req.url).pathname) ?? indexSpa(config.web);
}

for (const { hote, port } of config.ecouteWeb) {
  Bun.serve({
    hostname: hote,
    port,
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
          (session) => federation.distantes.membreDe(session),
        ),
      ...federation.relais.routes(),
      '/api/*': () => erreur('route inconnue', 404),
    },
    fetch: fichierBureau,
    websocket: {
      data: {} as DonneesClient,
      open: (ws) => {
        if (estTerminalFedere(ws)) return void federation.terminaux.ouvrir(ws);
        return estTerminal(ws) ? void terminaux.ouvert(ws) : diffusion.ajouter(ws);
      },
      close: (ws) => {
        if (estTerminalFedere(ws)) return federation.terminaux.ferme(ws);
        return estTerminal(ws) ? terminaux.ferme(ws) : diffusion.retirer(ws);
      },
      // Le flux : les clients écoutent et agissent par l'API HTTP. Un terminal : la frappe et les redimensionnements.
      message: (ws, m) => {
        if (estTerminalFedere(ws)) return federation.terminaux.recu(ws, m);
        return estTerminal(ws) ? terminaux.recu(ws, m) : undefined;
      },
      idleTimeout: 120,
      sendPings: true,
    },
  });
}

demarrerEcoutePostes({ ecoute: config.ecoutePostes, postes, journal });

duo.demarrer();
lancerRetention(registre, journal);
lancerRecalculInactivite(registre, diffusion, journal.child({ domaine: 'sessions' }));

journal.info(
  {
    central: config.central,
    web: config.ecouteWeb.map((a) => `${a.hote}:${a.port}`),
    postes: config.ecoutePostes.map((a) => `${a.hote ?? '*'}:${a.port}`),
    machinesAutorisees: [...config.secretsPostes.keys()],
  },
  'relais démarré',
);
