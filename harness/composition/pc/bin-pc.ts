#!/usr/bin/env bun
/**
 * Point d'entrée exécutable du process PC — le « plan d'exécution » de
 * `03-couche-1.md` (aucune décision, exécute des ordres du Pi). Premier
 * exécutable réel du dépôt pour ce process : jusqu'ici, `SuperviseurWorkers`
 * n'était instancié qu'en test ou en banc `acceptation/`.
 *
 * `☠ H-75` — le PC N'ÉCOUTE PLUS RIEN : il initie une connexion sortante vers
 * le Pi et se reconnecte indéfiniment (backoff+gigue) si elle tombe. Conçu
 * pour tourner sous `systemd --user` avec `Restart=always` (voir
 * `composition/deploiement/ccremote-pc.service`) : ce process ne boucle pas
 * lui-même sur un redémarrage complet après une fermeture terminale (secret
 * invalide, ex. 4401) — il journalise et s'arrête, systemd le relance.
 *
 * Variables d'environnement : voir `.env.example` à la racine de `harness/`.
 */

import { assemblerSuperviseurPc } from './assembler-superviseur.ts';
import { envObligatoire } from '../env.ts';
import { compositionLogger } from '../logger.ts';

const log = compositionLogger.child({ composant: 'bin-pc' });

function main(): void {
  const cheminRegistrePersistance = envObligatoire('CCREMOTE_PC_REGISTRE_DB');
  const urlPi = envObligatoire('CCREMOTE_LIEN_URL_PI');
  // `☠` Jamais de valeur par défaut (H-74, point 2) : un secret manquant doit
  // arrêter le démarrage bruyamment, jamais tourner sans authentification.
  const secretLienPi = envObligatoire('CCREMOTE_LIEN_SECRET');

  const assemble = assemblerSuperviseurPc({
    cheminRegistrePersistance,
    urlPi,
    secretLienPi,
    // `☠` Fermeture terminale (ex. secret invalide) : jamais de reconnexion
    // interne — H-75. On arrête le PROCESS ; systemd (`Restart=always`)
    // décide seul de la suite, après un délai, jamais un martèlement du Pi.
    surFermetureTerminale: (fermeture): void => {
      log.error({ fermeture }, 'arrêt du process PC suite à une fermeture terminale du lien — systemd redémarrera après RestartSec');
      process.exit(1);
    },
  });

  const arreterProprement = (signal: string): void => {
    log.info({ signal }, 'arrêt du process PC demandé');
    assemble.arreter();
    process.exit(0);
  };
  process.on('SIGINT', () => arreterProprement('SIGINT'));
  process.on('SIGTERM', () => arreterProprement('SIGTERM'));

  log.info({ urlPi }, 'process PC démarré — connexion sortante vers le Pi (H-75)');
}

try {
  main();
} catch (erreur) {
  compositionLogger.error({ err: erreur }, 'échec fatal au démarrage du process PC');
  process.exit(1);
}
