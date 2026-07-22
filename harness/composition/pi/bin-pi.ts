#!/usr/bin/env bun
/**
 * Point d'entrée exécutable du process Pi — le control plane, autorité unique
 * de `03-couche-1.md`. Premier exécutable réel du dépôt pour ce process :
 * jusqu'ici, `demarrerOrchestrateur` n'était appelé que par
 * `acceptation/orchestrateur-reel.ts`, avec des ports morts ou en mémoire.
 *
 * Variables d'environnement : voir `.env.example` à la racine de `harness/`.
 */

import { assemblerControlPlanePi } from './assembler-control-plane.ts';
import { envNombreOptionnel, envObligatoire, envOptionnel, envSeuilPctOptionnel } from '../env.ts';
import { compositionLogger } from '../logger.ts';

const log = compositionLogger.child({ composant: 'bin-pi' });

async function main(): Promise<void> {
  const cheminRegistreDb = envObligatoire('CCREMOTE_PI_REGISTRE_DB');
  const cheminIdentiteOrchestrateur = envObligatoire('CCREMOTE_PI_IDENTITE_ORCHESTRATEUR');
  const cheminIncidentsOrchestrateur = envObligatoire('CCREMOTE_PI_INCIDENTS_ORCHESTRATEUR');
  const repertoireProjets = envObligatoire('CCREMOTE_PI_REPERTOIRE_PROJETS');
  const cwdOrchestrateur = envOptionnel('CCREMOTE_PI_CWD_ORCHESTRATEUR', process.cwd());
  const configDirOrchestrateur = process.env['CCREMOTE_PI_CONFIG_DIR_ORCHESTRATEUR'];
  // H-75 : le Pi héberge le lien Pi↔PC (inversion — plus de dial-out vers le PC).
  const portLienPc = envNombreOptionnel('CCREMOTE_LIEN_PORT', 8721);
  const hostnameLienPc = envOptionnel('CCREMOTE_LIEN_HOST', '127.0.0.1');
  // `☠` Jamais de valeur par défaut : un secret de lien manquant doit arrêter le
  // démarrage bruyamment (H-74, point 2), jamais retomber sur une constante.
  const secretLienPc = envObligatoire('CCREMOTE_LIEN_SECRET');
  const seuilUtilisationPctPlafondParc = envSeuilPctOptionnel('CCREMOTE_PLAFOND_PARC_SEUIL_PCT');

  const assemble = await assemblerControlPlanePi({
    cheminRegistreDb,
    cheminIdentiteOrchestrateur,
    cheminIncidentsOrchestrateur,
    repertoireProjets,
    cwdOrchestrateur,
    configDirOrchestrateur,
    portLienPc,
    hostnameLienPc,
    secretLienPc,
    seuilUtilisationPctPlafondParc,
  });

  const arreterProprement = (signal: string): void => {
    log.info({ signal }, 'arrêt du process Pi demandé');
    assemble.serveurLien.arreter();
    assemble.orchestrateur.fermer();
    process.exit(0);
  };
  process.on('SIGINT', () => arreterProprement('SIGINT'));
  process.on('SIGTERM', () => arreterProprement('SIGTERM'));

  // Unique lecteur du flux (voir `demarrage.ts` : `demarrerOrchestrateur` ne
  // consomme jamais `query` lui-même). Ici, en attendant une vraie UI/API
  // (hors périmètre de cette mission), on se contente d'alimenter la
  // discipline de contexte — aucune décision n'est prise sur le contenu.
  for await (const message of assemble.orchestrateur.query) {
    assemble.orchestrateur.ingererMessage(message);
  }
}

main().catch((erreur: unknown) => {
  compositionLogger.error({ err: erreur }, 'échec fatal au démarrage du process Pi');
  process.exit(1);
});
