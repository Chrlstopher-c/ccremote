// Responsabilité : démarrer le relais puis le poste local dans ce processus, dans cet ordre, puis les arrêter
// proprement (sessions sauvées par le poste) quand l'appli ferme le tuyau d'entrée ou envoie SIGTERM.
// Poste seul (relais distant configuré) : ni relais ni base locale, le seul poste se relie au relais distant.
import { join } from 'node:path';
import { creerJournal } from '../commun/journal.ts';
import type { Logger } from 'pino';
import { construireEnvironnement, cheminsMoteur, contenuPosteJson, type ParametresEnvironnement } from './environnement.ts';
import { preparerDonnees, type Donnees } from './donnees.ts';
import { empreinteMotDePasse, secretDuPoste } from './secrets.ts';
import { extraireCodePoste, type CodePoste } from './code.ts';
import { enregistrerJeton } from './jeton.ts';
import { ecrirePosteJson } from './poste-json.ts';
import { attendrePosteLocal, ligneDePret } from './pret.ts';
import type { ParametresLancement } from './parametres.ts';
import type { RelaisDistant } from '../poste/relais-distant.ts';
import { VERSION } from '../commun/version.ts';

const DELAI_PRET_MS = 25_000;
// Nœud sans fenêtre (autonome) : au démarrage à froid de la machine (disque lent), le poste peut mettre plus longtemps.
const DELAI_PRET_AUTONOME_MS = 120_000;

export async function lancerMoteur(parametres: ParametresLancement): Promise<void> {
  const donnees = preparerDonnees(parametres.donnees);
  process.env['CCREMOTE_JOURNAL'] = donnees.journal;
  const journal = creerJournal('moteur');
  try {
    if (parametres.relaisDistant) await demarrerPosteSeul(parametres, parametres.relaisDistant, donnees, journal);
    else await demarrer(parametres, donnees, journal);
  } catch (erreur) {
    journal.error({ err: erreur }, 'moteur intégré : démarrage impossible');
    console.error('moteur intégré : démarrage impossible', erreur); // aussi dans le journal du système (systemd)
    process.exit(1);
  }
}

async function demarrer(p: ParametresLancement, donnees: Donnees, journal: Logger): Promise<void> {
  const chemins = cheminsMoteur(donnees.racine);
  const secret = secretDuPoste(chemins.secrets, donnees.machine);
  const empreinte = await empreinteMotDePasse(chemins.secrets);
  const code = await extraireCodePoste(p.codePoste, join(donnees.racine, 'code'));
  const parametresEnv = parametresDuMoteur(p, donnees, code, secret, empreinte);
  Object.assign(process.env, construireEnvironnement(parametresEnv));
  ecrirePosteJson(chemins.posteJson, contenuPosteJson(parametresEnv), journal);
  enregistrerJeton(chemins.base, p.jeton, journal);
  if (!p.autonome) arretALaFermetureEntree(journal);
  await import('../relais/bin.ts');
  await import('../poste/bin.ts');
  await attendrePosteLocal(`http://127.0.0.1:${p.portWeb}`, p.jeton, donnees.machine, p.autonome ? DELAI_PRET_AUTONOME_MS : DELAI_PRET_MS, journal);
  process.stdout.write(ligneDePret(donnees.machine, VERSION));
  journal.info({ machine: donnees.machine, web: p.portWeb, postes: p.portPostes }, 'moteur intégré prêt');
}

// Le jeton de poste est le secret de ce poste auprès du relais distant. L'annonce est immédiate : le poste se
// reconnecte seul (reconnexion existante), et l'interface affiche l'état du relais distant.
async function demarrerPosteSeul(
  p: ParametresLancement,
  distant: RelaisDistant,
  donnees: Donnees,
  journal: Logger,
): Promise<void> {
  const chemins = cheminsMoteur(donnees.racine);
  const code = await extraireCodePoste(p.codePoste, join(donnees.racine, 'code'));
  const parametresEnv = parametresDuMoteur(p, donnees, code, distant.jeton, '');
  Object.assign(process.env, construireEnvironnement(parametresEnv));
  ecrirePosteJson(chemins.posteJson, { ...contenuPosteJson(parametresEnv), relais: distant.url }, journal);
  if (!p.autonome) arretALaFermetureEntree(journal);
  await import('../poste/bin.ts');
  process.stdout.write(ligneDePret(donnees.machine, VERSION));
  journal.info({ machine: donnees.machine, relais: distant.url }, 'moteur intégré prêt : poste seul, relais distant');
}

function parametresDuMoteur(
  p: ParametresLancement,
  donnees: Donnees,
  code: CodePoste | null,
  secret: string,
  empreinte: string,
): ParametresEnvironnement {
  return {
    donnees: donnees.racine,
    portWeb: p.portWeb,
    portPostes: p.portPostes,
    machine: donnees.machine,
    description: donnees.description,
    secret,
    empreinte,
    claude: Bun.which('claude'),
    socketTmux: p.socketTmux,
    cc: code?.cc ?? null,
    tmuxConf: code?.tmuxConf ?? null,
    journal: donnees.journal,
  };
}

// Le tuyau d'entrée est tenu ouvert par l'appli : sa fermeture = l'appli s'arrête. SIGTERM passe par le poste, qui
// sauve ses sessions puis quitte.
function arretALaFermetureEntree(journal: Logger): void {
  process.stdin.on('end', () => {
    journal.info('entrée fermée : arrêt du moteur');
    process.kill(process.pid, 'SIGTERM');
  });
  process.stdin.resume();
}
