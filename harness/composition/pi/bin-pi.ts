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
  // `☠` La session orchestrateur est OPT-IN : elle consomme du quota en continu
  // et exige des credentials Claude valides sur le Pi. Tout le reste du control
  // plane fonctionne sans elle — la lier d'office rendrait le pilotage du parc
  // tributaire d'un `/login` sur le Pi.
  const avecOrchestrateur = process.env['CCREMOTE_PI_ORCHESTRATEUR'] === '1';
  const cheminRegistreDb = envObligatoire('CCREMOTE_PI_REGISTRE_DB');
  // Exigés seulement si la session maître est demandée : sans elle, imposer ces
  // chemins ferait échouer un démarrage parfaitement valide.
  const cheminIdentiteOrchestrateur = avecOrchestrateur
    ? envObligatoire('CCREMOTE_PI_IDENTITE_ORCHESTRATEUR')
    : envOptionnel('CCREMOTE_PI_IDENTITE_ORCHESTRATEUR', '/tmp/ccremote-identite-inutilisee');
  const cheminIncidentsOrchestrateur = avecOrchestrateur
    ? envObligatoire('CCREMOTE_PI_INCIDENTS_ORCHESTRATEUR')
    : envOptionnel('CCREMOTE_PI_INCIDENTS_ORCHESTRATEUR', '/tmp/ccremote-incidents-inutilises');
  const repertoireProjets = envObligatoire('CCREMOTE_PI_REPERTOIRE_PROJETS');
  const cwdOrchestrateur = envOptionnel('CCREMOTE_PI_CWD_ORCHESTRATEUR', process.cwd());
  const configDirOrchestrateur = process.env['CCREMOTE_PI_CONFIG_DIR_ORCHESTRATEUR'];
  // H-75 : le Pi héberge le lien Pi↔PC (inversion — plus de dial-out vers le PC).
  const portLienPc = envNombreOptionnel('CCREMOTE_LIEN_PORT', 8721);
  const hostnameLienPc = envOptionnel('CCREMOTE_LIEN_HOST', '127.0.0.1');
  // `☠` Jamais de valeur par défaut : un secret de lien manquant doit arrêter le
  // démarrage bruyamment (H-74, point 2), jamais retomber sur une constante.
  const secretLienPc = envObligatoire('CCREMOTE_LIEN_SECRET');
  // API web servie à `pi-web` (Flask), qui la relaie sous `/api/harness/...`.
  // Toujours en local : ce serveur n'a pas d'authentification propre.
  const portApiWeb = envNombreOptionnel('CCREMOTE_API_WEB_PORT', 8722);
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
    portApiWeb,
    seuilUtilisationPctPlafondParc,
    avecOrchestrateur,
  });

  const arreterProprement = (signal: string): void => {
    log.info({ signal }, 'arrêt du process Pi demandé');
    assemble.serveurApiWeb.arreter();
    assemble.serveurLien.arreter();
    assemble.orchestrateur?.fermer();
    process.exit(0);
  };
  process.on('SIGINT', () => arreterProprement('SIGINT'));
  process.on('SIGTERM', () => arreterProprement('SIGTERM'));

  // Unique lecteur du flux (voir `demarrage.ts` : `demarrerOrchestrateur` ne
  // consomme jamais `query` lui-même). Ici, en attendant une vraie UI/API
  // (hors périmètre de cette mission), on se contente d'alimenter la
  // discipline de contexte — aucune décision n'est prise sur le contenu.
  const orchestrateur = assemble.orchestrateur;
  if (orchestrateur === null) {
    log.info({}, 'control plane en service — parc, escalades et pilotage actifs, vue conversation inactive');
    // Rien à consommer : les serveurs (lien + API) tiennent le process vivant.
    return;
  }

  for await (const message of orchestrateur.query) {
    orchestrateur.ingererMessage(message);
  }
}

main().catch((erreur: unknown) => {
  compositionLogger.error({ err: erreur }, 'échec fatal au démarrage du process Pi');
  process.exit(1);
});
