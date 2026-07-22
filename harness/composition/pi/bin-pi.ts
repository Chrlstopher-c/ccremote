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

/** Parse `id=configDir,id2=configDir2` en liste de comptes. Entrées mal formées ignorées. */
function parserComptes(brut: string): { id: string; configDir: string; libelle: string }[] {
  const comptes: { id: string; configDir: string; libelle: string }[] = [];
  for (const paire of brut.split(',').map((p) => p.trim()).filter((p) => p.length > 0)) {
    const sep = paire.indexOf('=');
    if (sep === -1) continue;
    const id = paire.slice(0, sep);
    comptes.push({ id, configDir: paire.slice(sep + 1), libelle: `Compte ${id.slice(-1).toUpperCase()}` });
  }
  return comptes;
}

async function main(): Promise<void> {
  // `☠` La session orchestrateur est OPT-IN : elle consomme du quota en continu
  // et exige des credentials Claude valides sur le Pi. Tout le reste du control
  // plane fonctionne sans elle — la lier d'office rendrait le pilotage du parc
  // tributaire d'un `/login` sur le Pi.
  const avecOrchestrateur = process.env['CCREMOTE_PI_ORCHESTRATEUR'] === '1';
  const cheminRegistreDb = envObligatoire('CCREMOTE_PI_REGISTRE_DB');
  // `☠` L'identité SDK n'est plus un fichier unique : chaque conversation porte
  // son propre `session_id` en base (migration 2). Plus de
  // CCREMOTE_PI_IDENTITE_ORCHESTRATEUR à exiger.
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
  // Comptes Claude garantis au démarrage. Format : `id=configDir` séparés par
  // des virgules — ex. `compte-a=/home/.../compte-a,compte-b=/home/.../compte-b`.
  const comptes = parserComptes(envOptionnel('CCREMOTE_PI_COMPTES', ''));

  const assemble = await assemblerControlPlanePi({
    cheminRegistreDb,
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
    comptes,
  });

  const arreterProprement = (signal: string): void => {
    log.info({ signal }, 'arrêt du process Pi demandé');
    assemble.serveurApiWeb.arreter();
    assemble.serveurLien.arreter();
    assemble.gestionnaireConversations?.fermerTout();
    process.exit(0);
  };
  process.on('SIGINT', () => arreterProprement('SIGINT'));
  process.on('SIGTERM', () => arreterProprement('SIGTERM'));

  // `☠` Plus de lecteur global : le gestionnaire de conversations possède UNE
  // boucle de lecture par session, démarrée à la demande. Les serveurs (lien +
  // API) tiennent le process vivant. Rien à consommer ici.
  log.info(
    { avecOrchestrateur },
    'control plane Pi en service — parc, escalades et pilotage actifs ; conversations à la demande',
  );
}

main().catch((erreur: unknown) => {
  compositionLogger.error({ err: erreur }, 'échec fatal au démarrage du process Pi');
  process.exit(1);
});
