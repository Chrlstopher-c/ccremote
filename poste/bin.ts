// Responsabilité : point d'entrée du poste — assemble config, sessions tmux, socket local, sonde et lien au relais.
import { join } from 'node:path';
import { creerJournal } from '../commun/journal.ts';
import type { CommandeRelais, MessagePoste } from '../commun/protocole-poste.ts';
import { Comptes } from './comptes/comptes.ts';
import { chargerConfig } from './config.ts';
import { eteindreMachine } from './parc/alimentation.ts';
import { executerFichiers } from './fichiers/explorateur.ts';
import { SondeMachine } from './parc/etat-machine.ts';
import { LienRelais } from './parc/lien-relais.ts';
import { decouvrirProjets } from './projets/decouverte.ts';
import { GestionnaireSessions, type Reponse } from './session/gestionnaire.ts';
import { servirLocal } from './session/serveur-local.ts';
import { Terminaux } from './terminal/terminaux.ts';
import { SANS_REPONSE } from '../commun/appareil.ts';

const VERSION = '2.0.0';
const PERIODE_ETAT_MS = 15_000;

const journal = creerJournal('poste');
const config = chargerConfig();
const sonde = new SondeMachine(config.racines[0] ?? '/');
const socket = join(config.donnees, 'poste.sock');

let lien: LienRelais | null = null;
const envoyer = (m: MessagePoste): void => lien?.envoyer(m);

const sessions = new GestionnaireSessions(
  config,
  {
    evenement: (sessionId, evt) => envoyer({ kind: 'evenement', sessionId, ts: new Date().toISOString(), evt }),
    resume: (session) => envoyer({ kind: 'session', session }),
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
const comptes = new Comptes({
  config,
  journal,
  publier: (etats) => envoyer({ kind: 'comptes', comptes: etats }),
  enUsage: (compte) => sessions.lister().some((s) => s.compte === compte && s.tmux !== null),
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
  };
}

// Fichiers et terminaux : l'accès à l'appareil lui-même, hors de toute session Claude.
type CommandeAppareil = Extract<CommandeRelais, { kind: `fichier${string}` | 'dossier_creer' | `terminal_${string}` }>;
const estAppareil = (c: CommandeRelais): c is CommandeAppareil =>
  c.kind.startsWith('fichier') || c.kind === 'dossier_creer' || c.kind.startsWith('terminal_');

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

async function executer(c: CommandeRelais): Promise<Reponse> {
  if (estAppareil(c)) return executerAppareil(c);
  if (c.kind === 'ouvrir') return sessions.ouvrir(c.demande);
  if (c.kind === 'projets') return { ok: true, donnees: decouvrirProjets(config.machine, config.racines) };
  if (c.kind === 'eteindre') return eteindreMachine(journal);
  if (c.kind === 'compte_connecter') return comptes.connecter(c.nom, c.email);
  if (c.kind === 'compte_code') return comptes.valider(c.nom, c.code);
  if (c.kind === 'compte_retirer') return comptes.retirer(c.nom);
  if (c.kind === 'comptes_relever') return comptes.relever().then(() => ({ ok: true, donnees: comptes.lister() }));
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
comptes.demarrer();
lien = new LienRelais({
  url: config.relais,
  machine: config.machine,
  secret: config.secret,
  journal,
  bonjour,
  surCommande,
});
lien.demarrer();
setInterval(() => envoyer({ kind: 'etat_machine', etat: sonde.mesurer() }), PERIODE_ETAT_MS);
journal.info({ machine: config.machine, relais: config.relais }, 'poste démarré');

// Les Claude vivent dans tmux, pas dans le poste : arrêter le poste ne coupe aucune session.
function arreter(): void {
  journal.info('arrêt du poste (les sessions tmux continuent)');
  sessions.sauvegarder();
  terminaux.fermerTout();
  lien?.arreter();
  process.exit(0);
}
process.on('SIGTERM', arreter);
process.on('SIGINT', arreter);
