/**
 * Responsabilité : LA racine de composition du PC — construit le graphe
 * d'objets réel du superviseur de workers (branche B/D.3, mission M-13) et le
 * rend joignable depuis le Pi. Avant ce fichier, aucun exécutable ne
 * construisait `SuperviseurWorkers` avec ses dépendances réelles : les tests
 * l'instanciaient avec des doublures, `demarrerWorker` par défaut n'était
 * jamais exercé en dehors des bancs `acceptation/`.
 *
 * Garde-fous branchés ICI, réellement, pour la première fois en production :
 *  - persistance du registre + restauration au démarrage (dette n°1, H-74) ;
 *  - juge anti-boucle réel (H-68) — `jugeBoucle` était optionnel « uniquement
 *    parce qu'aucun appelant de production n'existe » (superviseur-workers-types.ts).
 *    Ce fichier EST ce premier appelant.
 */

import { CompteurRelances } from '../../relance/compteur-relances.ts';
import { creerJugeHaiku } from '../../anti-boucle/index.ts';
import { PersistanceRegistreSqlite, SuperviseurWorkers } from '../../superviseur/index.ts';
import { compositionLogger } from '../logger.ts';
import { demarrerServeurControlePc, type ServeurControlePc } from './serveur-controle.ts';

const log = compositionLogger.child({ composant: 'assembler-superviseur-pc' });

export interface OptionsAssemblageSuperviseurPc {
  /** Chemin du fichier SQLite de persistance du registre (dette n°1). `:memory:` accepté hors production. */
  readonly cheminRegistrePersistance: string;
  readonly port: number;
  readonly hostname?: string;
  readonly plafondRelancesDefaut?: number;
}

export interface SuperviseurPcAssemble {
  readonly superviseur: SuperviseurWorkers;
  readonly serveur: ServeurControlePc;
  arreter(): void;
}

/**
 * Construit le superviseur PC complet et l'expose sur le réseau. Fonction
 * synchrone-en-esprit : aucune I/O bloquante autre que l'ouverture du fichier
 * SQLite (déjà fait par `PersistanceRegistreSqlite`) et le bind du port.
 */
export function assemblerSuperviseurPc(options: OptionsAssemblageSuperviseurPc): SuperviseurPcAssemble {
  const persistance = new PersistanceRegistreSqlite({ chemin: options.cheminRegistrePersistance });
  const compteurRelances = new CompteurRelances(options.plafondRelancesDefaut);
  const jugeBoucle = creerJugeHaiku();

  const superviseur = new SuperviseurWorkers({
    compteurRelances,
    persistance,
    jugeBoucle,
  });

  // Dette n°1 : SANS cet appel, un redémarrage du PC repart avec un registre
  // vide alors que des workers peuvent encore tourner sur disque (H-74).
  superviseur.restaurer();
  log.info({ cheminRegistrePersistance: options.cheminRegistrePersistance }, 'registre PC restauré au démarrage (dette n°1 fermée en composition)');

  const serveur = demarrerServeurControlePc(superviseur, { port: options.port, hostname: options.hostname });

  return {
    superviseur,
    serveur,
    arreter: (): void => serveur.arreter(),
  };
}
