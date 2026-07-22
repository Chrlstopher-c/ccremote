#!/usr/bin/env bun
/**
 * Point d'entrée exécutable du process PC — le « plan d'exécution » de
 * `03-couche-1.md` (aucune décision, exécute des ordres du Pi). Premier
 * exécutable réel du dépôt pour ce process : jusqu'ici, `SuperviseurWorkers`
 * n'était instancié qu'en test ou en banc `acceptation/`.
 *
 * Variables d'environnement : voir `.env.example` à la racine de `harness/`.
 */

import { assemblerSuperviseurPc } from './assembler-superviseur.ts';
import { envNombreOptionnel, envObligatoire, envOptionnel } from '../env.ts';
import { compositionLogger } from '../logger.ts';

const log = compositionLogger.child({ composant: 'bin-pc' });

function main(): void {
  const port = envNombreOptionnel('CCREMOTE_PC_CONTROLE_PORT', 8721);
  const hostname = envOptionnel('CCREMOTE_PC_CONTROLE_HOST', '0.0.0.0');
  const cheminRegistrePersistance = envObligatoire('CCREMOTE_PC_REGISTRE_DB');

  const assemble = assemblerSuperviseurPc({ cheminRegistrePersistance, port, hostname });

  const arreterProprement = (signal: string): void => {
    log.info({ signal }, 'arrêt du process PC demandé');
    assemble.arreter();
    process.exit(0);
  };
  process.on('SIGINT', () => arreterProprement('SIGINT'));
  process.on('SIGTERM', () => arreterProprement('SIGTERM'));

  log.info({ port, hostname }, 'process PC démarré — canal de contrôle D.3 en écoute');
}

try {
  main();
} catch (erreur) {
  compositionLogger.error({ err: erreur }, 'échec fatal au démarrage du process PC');
  process.exit(1);
}
