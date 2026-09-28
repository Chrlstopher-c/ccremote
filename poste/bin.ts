// Responsabilité : point d'entrée du poste — assemble config, sessions tmux, socket local, sonde et lien au relais.
import { join } from 'node:path';
import { creerJournal } from '../commun/journal.ts';
import type { CommandeRelais, MessagePoste } from '../commun/protocole-poste.ts';
import { chargerConfig } from './config.ts';
import { eteindreMachine } from './parc/alimentation.ts';
import { SondeMachine } from './parc/etat-machine.ts';
import { LienRelais } from './parc/lien-relais.ts';
import { decouvrirProjets } from './projets/decouverte.ts';
import { GestionnaireSessions, type Reponse } from './session/gestionnaire.ts';
import { servirLocal } from './session/serveur-local.ts';

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

function bonjour(): MessagePoste {
  return {
    kind: 'bonjour',
    version: VERSION,
    description: config.description,
    racines: [...config.racines],
    projets: decouvrirProjets(config.machine, config.racines),
    comptes: Object.keys(config.comptes),
    sessions: sessions.lister(),
  };
}

async function executer(c: CommandeRelais): Promise<Reponse> {
  if (c.kind === 'ouvrir') return sessions.ouvrir(c.demande);
  if (c.kind === 'projets') return { ok: true, donnees: decouvrirProjets(config.machine, config.racines) };
  if (c.kind === 'eteindre') return eteindreMachine(journal);
  return sessions.executer(c);
}

async function surCommande(c: CommandeRelais): Promise<MessagePoste> {
  try {
    const r = await executer(c);
    return { kind: 'reponse', id: c.id, ok: r.ok, erreur: r.erreur, donnees: r.donnees };
  } catch (erreur) {
    journal.error({ err: erreur, commande: c.kind }, 'commande en échec');
    return { kind: 'reponse', id: c.id, ok: false, erreur: String(erreur) };
  }
}

servirLocal(socket, sessions, journal);
sessions.demarrer();
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
  lien?.arreter();
  process.exit(0);
}
process.on('SIGTERM', arreter);
process.on('SIGINT', arreter);
