// Responsabilité : démarrer le relais puis le poste local dans ce processus, dans cet ordre, puis les arrêter
// proprement (sessions sauvées par le poste) quand l'appli ferme le tuyau d'entrée ou envoie SIGTERM.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { creerJournal } from '../commun/journal.ts';
import type { Logger } from 'pino';
import { construireEnvironnement, cheminsMoteur, contenuPosteJson, type ParametresEnvironnement } from './environnement.ts';
import { preparerDonnees, type Donnees } from './donnees.ts';
import { empreinteMotDePasse, secretDuPoste } from './secrets.ts';
import { extraireCodePoste } from './code.ts';
import { enregistrerJeton } from './jeton.ts';
import { attendrePosteLocal, ligneDePret } from './pret.ts';
import type { ParametresLancement } from './parametres.ts';

const VERSION_PAR_DEFAUT = '2.0.0';
const DELAI_PRET_MS = 25_000;

export async function lancerMoteur(parametres: ParametresLancement): Promise<void> {
  const donnees = preparerDonnees(parametres.donnees);
  process.env['CCREMOTE_JOURNAL'] = donnees.journal;
  const journal = creerJournal('moteur');
  try {
    await demarrer(parametres, donnees, journal);
  } catch (erreur) {
    journal.error({ err: erreur }, 'moteur intégré : démarrage impossible');
    process.exit(1);
  }
}

async function demarrer(p: ParametresLancement, donnees: Donnees, journal: Logger): Promise<void> {
  const chemins = cheminsMoteur(donnees.racine);
  const secret = secretDuPoste(chemins.secrets, donnees.machine);
  const empreinte = await empreinteMotDePasse(chemins.secrets);
  const code = await extraireCodePoste(p.codePoste, join(donnees.racine, 'code'));
  const parametresEnv: ParametresEnvironnement = {
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
  Object.assign(process.env, construireEnvironnement(parametresEnv));
  writeFileSync(chemins.posteJson, `${JSON.stringify(contenuPosteJson(parametresEnv), null, 2)}\n`, { mode: 0o600 });
  enregistrerJeton(chemins.base, p.jeton, journal);
  arretALaFermetureEntree(journal);
  await import('../relais/bin.ts');
  await import('../poste/bin.ts');
  await attendrePosteLocal(`http://127.0.0.1:${p.portWeb}`, p.jeton, donnees.machine, DELAI_PRET_MS, journal);
  process.stdout.write(ligneDePret(donnees.machine, VERSION_PAR_DEFAUT));
  journal.info({ machine: donnees.machine, web: p.portWeb, postes: p.portPostes }, 'moteur intégré prêt');
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
