// Responsabilité : point d'entrée du poste — assemble config, sessions tmux, socket local, sonde et lien au relais.
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { creerJournal } from '../commun/journal.ts';
import { COMMIT, VERSION } from '../commun/version.ts';
import { type CommandeRelais, type MessagePoste, TAILLE_LOT_HISTORIQUE } from '../commun/protocole-poste.ts';
import { Comptes } from './comptes/comptes.ts';
import { LecteurCompte } from './comptes/lecture-compte.ts';
import { chargerConfig } from './config.ts';
import { eteindreMachine } from './parc/alimentation.ts';
import { type CommandeAppareil, estAppareil } from './fichiers/appareil.ts';
import { executerFichiers } from './fichiers/explorateur.ts';
import { SondeMachine } from './parc/etat-machine.ts';
import { LienRelais } from './parc/lien-relais.ts';
import { decouvrirProjets } from './projets/decouverte.ts';
import { GestionnaireSessions, type Reponse } from './session/gestionnaire.ts';
import { servirLocal } from './session/serveur-local.ts';
import { Terminaux } from './terminal/terminaux.ts';
import { SANS_REPONSE } from '../commun/appareil.ts';
import { estCommandeConfiguration, executerConfiguration } from './configuration/commande.ts';
import { dossierClaudeDefaut } from './configuration/styles.ts';
import { rechargerStylesVivants } from './session/styles-session.ts';
import { creerListeurConnecteurs, DELAI_CONNECTEURS_MS } from './configuration/connecteurs.ts';
import { lanceurClaude } from './configuration/exec.ts';
import { dossierChantiers } from './entretien/chantiers.ts';
import { type ContexteEntretien, estEntretien, executerEntretien } from './entretien/commandes.ts';
import { versionsClaudeCode } from './entretien/claude-code.ts';
import { estReste, executerReste, type ContexteReste } from './reste/executer.ts';
import { fichierClaudeJson } from './reste/memoire.ts';
import { cheminSocketDictee } from './reste/dictee.ts';
import { decouvrirScript } from './reste/dictee-moteur.ts';
import { ServiceMoteurDictee } from './reste/dictee-service.ts';
import { estResteLot2, executerResteLot2, type ContexteResteLot2 } from './reste/executer-lot2.ts';
import { type ContextePariteposte, estParite, executerParite } from './parite/executer.ts';
import { transcriptDeSession } from './parite/transcript-session.ts';
import { MinuterieTaches } from './reste/minuterie-taches.ts';
import { ServiceTaches } from './reste/taches-planifiees.ts';
import { cheminTranscript } from './session/transcript.ts';
import { dossiersProjets } from './session/decouverte.ts';
import { SOCKET } from './session/tmux.ts';
import { DOSSIER_MODULES_SOURCE, SurveillanceModules } from './modules/surveillance.ts';
import { DOSSIER_DONNEES_MODULES, DOSSIER_JOURNAUX_MODULES, ServeursModules } from './modules/serveur/serveurs.ts';

const PERIODE_ETAT_MS = 15_000;

const journal = creerJournal('poste');
const config = chargerConfig();
const DELAI_CLAUDE_MS = 20_000;
const sonde = new SondeMachine(config.racines[0] ?? '/', journal);
const versionsClaude = await versionsClaudeCode(journal);
const socket = join(config.donnees, 'poste.sock');

let lien: LienRelais | null = null;
const envoyer = (m: MessagePoste): void => lien?.envoyer(m);
// Les serveurs des modules de ce poste (v1.2) : lancés hors de l'appli, arrêtés à l'arrêt du poste.
const serveurs = new ServeursModules({
  machine: config.machine,
  dossierDonnees: DOSSIER_DONNEES_MODULES,
  dossierJournaux: DOSSIER_JOURNAUX_MODULES,
  envoyer,
  journal: journal.child({ domaine: 'modules' }),
});

const sessions = new GestionnaireSessions(
  config,
  {
    evenement: (sessionId, evt) =>
      evt.type === 'flux'
        ? envoyer({ kind: 'flux', sessionId, bloc: evt.bloc, delta: evt.delta, genre: evt.genre, agent: evt.agent })
        : envoyer({ kind: 'evenement', sessionId, ts: new Date().toISOString(), evt }),
    historique: (sessionId, evenements) => {
      const replay = randomUUID();
      for (let i = 0; i < evenements.length; i += TAILLE_LOT_HISTORIQUE) {
        envoyer({ kind: 'historique', sessionId, replay, evenements: evenements.slice(i, i + TAILLE_LOT_HISTORIQUE) });
      }
    },
    resume: (session) => envoyer({ kind: 'session', session }),
    recalage: (sessionId, archiver, lignes) =>
      envoyer({
        kind: 'recalage',
        sessionId,
        archiver,
        ...(lignes ? { lignes: [...lignes.cles], messages: [...lignes.messages], jusqua: lignes.jusqua } : {}),
      }),
    decouvertes: (decouvertes, transcripts, desktop) =>
      envoyer({ kind: 'decouvertes', decouvertes, transcripts, desktop }),
  },
  socket,
  journal,
);

const terminaux = new Terminaux(
  {
    sortie: (terminal, base64) => envoyer({ kind: 'terminal_sortie', terminal, base64 }),
    fin: (terminal, code) => envoyer({ kind: 'terminal_fin', terminal, code }),
  },
  journal,
);
sessions.surLimite = (compte, limite) => comptes.limiteSdk(compte, limite);
const comptes = new Comptes({
  config,
  journal,
  publier: (etats) => envoyer({ kind: 'comptes', comptes: etats }),
  publierLimite: (cle, limite) => envoyer({ kind: 'compte_limite', cle, limite }),
  enUsage: (compte) => sessions.enUsage(compte),
  lecteur: new LecteurCompte({ journal }),
  usageSdk: (compte) => sessions.usageCompte(compte),
});

function bonjour(): MessagePoste {
  return {
    kind: 'bonjour',
    version: VERSION,
    description: config.description,
    racines: [...config.racines],
    projets: decouvrirProjets(config.machine, config.racines),
    comptes: Object.keys(config.comptes),
    etatComptes: comptes.lister(),
    sessions: sessions.lister(),
    decouvertes: sessions.listeDecouvertes(),
    transcripts: sessions.transcriptsConnus(),
    desktop: sessions.fichesDesktop(),
    empreinte: process.env['CCREMOTE_EMPREINTE_CODE'] || undefined, // code installé par le relais (mise à jour)
    commit: COMMIT,
    claudeCode: versionsClaude,
  };
}

// Fichiers et terminaux : l'accès à l'appareil lui-même, hors de toute session Claude.
async function executerAppareil(c: CommandeAppareil): Promise<Reponse> {
  switch (c.kind) {
    case 'fichiers_lister':
    case 'fichier_lire':
    case 'fichier_ecrire':
    case 'fichier_supprimer':
    case 'fichier_renommer':
    case 'dossier_creer':
      return executerFichiers(c, journal);
    case 'terminal_ouvrir':
      return terminaux.ouvrir(c.terminal, c.cible, c.colonnes, c.lignes);
    case 'terminal_entree':
      terminaux.entree(c.terminal, c.base64);
      return { ok: true };
    case 'terminal_taille':
      terminaux.taille(c.terminal, c.colonnes, c.lignes);
      return { ok: true };
    case 'terminal_fermer':
      terminaux.fermer(c.terminal);
      return { ok: true };
  }
}

// Configuration Claude de la machine (styles, CLAUDE.md, compétences, connecteurs, plug-ins) : hors de toute session.
const configuration = {
  dossierConfig: dossierClaudeDefaut(),
  lancer: lanceurClaude(DELAI_CLAUDE_MS, journal),
  connecteurs: creerListeurConnecteurs({ lancer: lanceurClaude(DELAI_CONNECTEURS_MS, journal) }),
  recharger: () => rechargerStylesVivants(sessions.sessions.values()),
  journal,
};

// L'entretien : chantiers, processus, sessions tmux, réveil. Sessions suivies : celles des fiches du gestionnaire.
const contexteEntretien: ContexteEntretien = {
  machine: config.machine,
  racine: process.pid,
  lancement: randomUUID(),
  fichierRegistre: join(config.donnees, 'processus.json'),
  dossierChantiers: dossierChantiers(),
  reveilFactice: process.env['CCREMOTE_REVEIL_FACTICE'] || undefined,
  sessionDePid: () => null, // le gestionnaire ne relie pas encore un pid SDK à sa session : null (voir STATE)
  suivis: () =>
    new Set([...sessions.sessions.values()].map((s) => s.resume.tmux).filter((n): n is string => n !== null)),
  partage: SOCKET === 'claude',
  envoyes: new Set(),
  journal,
};

// La vague « reste » : recherche dans les transcripts, mémoire Hippocampe, commandes Claude (lecture, sauf une création).
const contexteReste: ContexteReste = {
  racines: () => dossiersProjets([null, ...Object.values(config.comptes)]),
  dossierConfig: dossierClaudeDefaut(),
  fichierClaudeJson: fichierClaudeJson(),
  journal,
};

// Le lot 2 : compactions, fusion (PR), dictée, tâches planifiées (une minuterie du poste les exécute).
const taches = new ServiceTaches({
  fichier: join(config.donnees, 'taches-planifiees.json'),
  machine: config.machine,
  description: config.description,
  racines: config.racines,
  ouvrir: (d) => sessions.ouvrir(d),
  journal,
});
// Le service de dictée : pilote le script moteur de ce poste et arrête le moteur qu'il a lancé après inactivité.
const dicteeService = new ServiceMoteurDictee({
  script: decouvrirScript(process.env, homedir()),
  dossierRun: dirname(cheminSocketDictee(process.env, process.getuid?.())),
  fichierReglages: join(config.donnees, 'dictee-service.json'),
  journal: journal.child({ domaine: 'dictee' }),
});
const contexteResteLot2: ContexteResteLot2 = {
  session: (id) => {
    const s = sessions.session(id);
    if (!s) return null;
    const conversation = s.resume.claudeSessionId;
    const transcript = conversation ? cheminTranscript(s.resume.cwd, conversation, s.persistee.configDir) : null;
    return { cwd: s.resume.cwd, transcript };
  },
  taches,
  socketDictee: () => cheminSocketDictee(process.env, process.getuid?.()),
  dicteeService,
  journal,
};
const minuterieTaches = new MinuterieTaches(taches, journal.child({ domaine: 'taches' }));

// La parité : contexte, résultats, tâches et dépôt lus dans le transcript (lecture seule).
const contexteParite: ContextePariteposte = {
  transcript: (c) =>
    transcriptDeSession(
      c,
      sessions.session(c.sessionId)?.persistee.configDir,
      [null, ...Object.values(config.comptes)],
      journal,
    ),
  fenetre: config.fenetreContexte,
  journal: journal.child({ domaine: 'parite' }),
};

async function executer(c: CommandeRelais): Promise<Reponse> {
  if (estAppareil(c)) return executerAppareil(c);
  if (estEntretien(c)) return executerEntretien(c, contexteEntretien);
  if (estReste(c)) return executerReste(c, contexteReste);
  if (estResteLot2(c)) return executerResteLot2(c, contexteResteLot2);
  if (estParite(c)) return executerParite(c, contexteParite);
  if (c.kind === 'ouvrir') return sessions.ouvrir(c.demande);
  if (c.kind === 'projets') return { ok: true, donnees: decouvrirProjets(config.machine, config.racines) };
  if (c.kind === 'importables') return sessions.importables();
  if (c.kind === 'importer') return sessions.importer(c.ids);
  if (c.kind === 'eteindre') return eteindreMachine(journal);
  if (c.kind === 'module_requete') return serveurs.requete(c.module, c.requete);
  if (c.kind === 'compte_connecter') return comptes.connecter(c.nom, c.email);
  if (c.kind === 'compte_code') return comptes.valider(c.nom, c.code);
  if (c.kind === 'compte_retirer') return comptes.retirer(c.nom);
  if (c.kind === 'comptes_relever') return comptes.relever().then(() => ({ ok: true, donnees: comptes.lister() }));
  if (c.kind === 'compte_releve') return comptes.releverUsageCompte(c.nom);
  if (c.kind === 'compte_detail') return comptes.detail(c.nom, c.fourni);
  if (c.kind === 'compte_distant') {
    const r = sessions.basculerDistant(c.nom, c.actif);
    envoyer({ kind: 'comptes', comptes: comptes.lister() });
    return r;
  }
  if (c.kind === 'compte_reinitialiser') return comptes.reinitialiser(c.nom, c.offre);
  if (estCommandeConfiguration(c)) return executerConfiguration(c, configuration);
  return sessions.executer(c);
}

async function surCommande(c: CommandeRelais): Promise<MessagePoste | null> {
  try {
    const r = await executer(c);
    if (SANS_REPONSE.has(c.kind)) return null;
    return { kind: 'reponse', id: c.id, ok: r.ok, erreur: r.erreur, donnees: r.donnees };
  } catch (erreur) {
    journal.error({ err: erreur, commande: c.kind }, 'commande en échec');
    return { kind: 'reponse', id: c.id, ok: false, erreur: String(erreur) };
  }
}

servirLocal(socket, sessions, journal);
sessions.demarrer();
minuterieTaches.demarrer();
dicteeService.demarrerSurveillance();
comptes.demarrer();
lien = new LienRelais({
  url: config.relais,
  machine: config.machine,
  secret: config.secret,
  journal,
  bonjour,
  surCommande,
  surOuverture: () => {
    sessions.recalerFils();
    serveurs.republier();
  },
});
sessions.relaisOuvert = () => lien?.estOuvert === true;
lien.demarrer();
new SurveillanceModules({ dossier: DOSSIER_MODULES_SOURCE, envoyer, journal, serveurs }).demarrer();
setInterval(() => envoyer({ kind: 'etat_machine', etat: sonde.mesurer() }), PERIODE_ETAT_MS);
journal.info({ machine: config.machine, relais: config.relais }, 'poste démarré');

// Les Claude tmux ne sont pas au poste : arrêter le poste ne les coupe pas. Les processus SDK s'arrêtent avec lui.
async function arreter(): Promise<void> {
  journal.info('arrêt du poste (les sessions tmux continuent, les processus SDK s’arrêtent)');
  sessions.sauvegarder();
  sessions.arreterProcessus();
  minuterieTaches.arreter();
  dicteeService.arreterSurveillance();
  terminaux.fermerTout();
  await serveurs.arreterTout();
  lien?.arreter();
  process.exit(0);
}
process.on('SIGTERM', arreter);
process.on('SIGINT', arreter);
