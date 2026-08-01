#!/usr/bin/env bun
/**
 * Point d'entrée exécutable du process PC — le « plan d'exécution » de
 * `03-couche-1.md` (aucune décision, exécute des ordres du Pi). Premier
 * exécutable réel du dépôt pour ce process : jusqu'ici, `SuperviseurWorkers`
 * n'était instancié qu'en test ou en banc `acceptation/`.
 *
 * `☠ H-75` — le PC N'ÉCOUTE PLUS RIEN : il initie une connexion sortante vers
 * le Pi et se reconnecte indéfiniment (backoff+gigue) si elle tombe. Conçu
 * pour tourner sous `systemd --user` (voir `composition/deploiement/
 * ccremote-pc.service`) : ce process ne boucle pas lui-même sur un redémarrage
 * complet après une fermeture terminale (secret invalide, ex. 4401) — il
 * journalise et s'arrête, systemd le relance.
 *
 * `☠ TROUVÉ EN RELECTURE (2026-07-22)` — le refus terminal se voulait « jamais
 * un martèlement du Pi », mais l'unité systemd le relançait toutes les 10 s :
 * le garde-fou du transport était NEUTRALISÉ à l'assemblage, une fois de plus
 * (même forme que les cinq garde-fous branchés sur rien). Deux corrections :
 * le code de sortie distingue désormais une erreur de CONFIGURATION (78,
 * `EX_CONFIG`) d'un plantage (1) — visible dans `systemctl --user status` —
 * et `RestartSec` passe à 60 s.
 *
 * Pourquoi relancer quand même, plutôt que s'arrêter net sur un secret refusé :
 * la cause probable est côté Pi (env non chargé après un redémarrage), et
 * l'exigence d'exploitation est « tout se reconnecte tout seul ». Un service
 * arrêté net obligerait Chris à ouvrir un SSH depuis son téléphone — le coût
 * de l'erreur est bien plus élevé dans ce sens que dans l'autre, où elle ne
 * coûte qu'une tentative par minute.
 *
 * Variables d'environnement : voir `.env.example` à la racine de `harness/`.
 */

/** `EX_CONFIG` (sysexits.h) — l'environnement est faux, pas le code. */
const CODE_SORTIE_CONFIG = 78;

import { hostname } from 'node:os';
import { assemblerSuperviseurPc } from './assembler-superviseur.ts';
import { EnvManquantError, envObligatoire } from '../env.ts';
import { normaliserMachineId } from '../lien-pc-pi/identite-machine.ts';
import { compositionLogger } from '../logger.ts';

const log = compositionLogger.child({ composant: 'bin-pc' });

function main(): void {
  const cheminRegistrePersistance = envObligatoire('CCREMOTE_PC_REGISTRE_DB');
  const urlPi = envObligatoire('CCREMOTE_LIEN_URL_PI');
  // `☠` Jamais de valeur par défaut (H-74, point 2) : un secret manquant doit
  // arrêter le démarrage bruyamment, jamais tourner sans authentification.
  const secretLienPi = envObligatoire('CCREMOTE_LIEN_SECRET');
  // `☠` Identité de CETTE machine. Le défaut `hostname()` est délibéré et sûr :
  // il est déjà distinct sur chaque machine réelle (`TrinityArch`,
  // `vps-e411b5c7`), donc l'ajout d'une machine ne demande AUCUNE configuration
  // — la voie d'échec serait qu'un opérateur oublie de la fixer et que deux
  // machines s'annoncent pareil. Le seul cas où deux hostnames coïncident est
  // une machine clonée ; la variable est là pour ça, jamais pour l'usage courant.
  const machineId = normaliserMachineId(process.env['CCREMOTE_MACHINE_ID'] ?? hostname());
  if (machineId === null) {
    throw new EnvManquantError(
      'CCREMOTE_MACHINE_ID invalide (et hostname() inutilisable) — attendu : minuscules, chiffres, « . _ - », 63 caractères max',
    );
  }
  // `☠` Les comptes vivent ICI, sur le PC : seul ce process peut mesurer leurs
  // fenêtres de rate limit. Même format que côté Pi (`id=configDir,…`) pour
  // qu'un opérateur n'ait pas deux syntaxes à retenir.
  const comptesASonder = (process.env['CCREMOTE_PC_COMPTES'] ?? '')
    .split(',')
    .map((paire) => paire.trim())
    .filter((paire) => paire.includes('='))
    .map((paire) => ({ id: paire.slice(0, paire.indexOf('=')), configDir: paire.slice(paire.indexOf('=') + 1) }));

  const assemble = assemblerSuperviseurPc({
    cheminRegistrePersistance,
    urlPi,
    secretLienPi,
    machineId,
    comptesASonder,
    // `☠` Fermeture terminale (ex. secret invalide) : jamais de reconnexion
    // interne — H-75. On arrête le PROCESS ; systemd décide seul de la suite,
    // après `RestartSec=60`, jamais un martèlement du Pi.
    surFermetureTerminale: (fermeture): void => {
      log.error(
        { fermeture, codeSortie: CODE_SORTIE_CONFIG },
        'arrêt du process PC — fermeture terminale du lien (secret refusé ou rejet permanent). Vérifier CCREMOTE_LIEN_SECRET des DEUX côtés',
      );
      process.exit(CODE_SORTIE_CONFIG);
    },
  });

  const arreterProprement = (signal: string): void => {
    log.info({ signal }, 'arrêt du process PC demandé');
    assemble.arreter();
    process.exit(0);
  };
  process.on('SIGINT', () => arreterProprement('SIGINT'));
  process.on('SIGTERM', () => arreterProprement('SIGTERM'));

  log.info({ urlPi, machineId }, 'process machine de travail démarré — connexion sortante vers le Pi (H-75)');
}

try {
  main();
} catch (erreur) {
  // Une variable d'environnement manquante est une erreur de configuration,
  // pas un plantage — `systemctl status` doit permettre de les distinguer sans
  // aller lire le journal.
  const codeSortie = erreur instanceof EnvManquantError ? CODE_SORTIE_CONFIG : 1;
  compositionLogger.error({ err: erreur, codeSortie }, 'échec fatal au démarrage du process PC');
  process.exit(codeSortie);
}
