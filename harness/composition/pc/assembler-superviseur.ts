/**
 * Responsabilité : LA racine de composition du PC — construit le graphe
 * d'objets réel du superviseur de workers (branche B/D.3, mission M-13) et le
 * connecte au Pi. Avant ce fichier, aucun exécutable ne construisait
 * `SuperviseurWorkers` avec ses dépendances réelles : les tests l'instanciaient
 * avec des doublures, `demarrerWorker` par défaut n'était jamais exercé en
 * dehors des bancs `acceptation/`.
 *
 * Garde-fous branchés ICI, réellement, pour la première fois en production :
 *  - persistance du registre + restauration au démarrage (dette n°1, H-74),
 *    boot_id compris (H-75 — voir `superviseur/identite-boot.ts`, déjà câblé
 *    en amont par `SuperviseurWorkers.restaurer()`, rien à ajouter ici) ;
 *  - juge anti-boucle réel (H-68) — `jugeBoucle` était optionnel « uniquement
 *    parce qu'aucun appelant de production n'existe » (superviseur-workers-types.ts).
 *    Ce fichier EST ce premier appelant.
 *
 * `☠ H-75` — le PC N'HÉBERGE PLUS RIEN. Avant cette mission, ce fichier
 * démarrait un serveur WebSocket local (`demarrerServeurControlePc`,
 * `serveur-controle.ts`, supprimé). Il ouvre maintenant une connexion
 * SORTANTE vers le Pi (`client-lien-pi.ts`) et reçoit les opérations de
 * contrôle sur cette même connexion (`canal-controle-recepteur.ts`).
 */

import { CompteurRelances } from '../../relance/compteur-relances.ts';
import { creerJugeHaiku } from '../../anti-boucle/index.ts';
import { PersistanceRegistreSqlite, SuperviseurWorkers } from '../../superviseur/index.ts';
import type { FermetureTerminale } from '../../transport/contrat.ts';
import type { LienWebSocket } from '../../transport/lien-websocket.ts';
import { compositionLogger } from '../logger.ts';
import { cablerRecepteurControlePc, type RecepteurControlePc } from './canal-controle-recepteur.ts';
import { construireWorkerSpec } from './construire-worker-spec.ts';
import { CollecteurAuditPermissions, creerHooksAuditPermissions } from '../../control-plane/audit-permissions/index.ts';
import { creerClientLienPi } from './client-lien-pi.ts';

const log = compositionLogger.child({ composant: 'assembler-superviseur-pc' });

export interface OptionsAssemblageSuperviseurPc {
  /** Chemin du fichier SQLite de persistance du registre (dette n°1). `:memory:` accepté hors production. */
  readonly cheminRegistrePersistance: string;
  /** `ws://` ou `wss://` du Pi, SANS le secret (voir `client-lien-pi.ts`). */
  readonly urlPi: string;
  readonly secretLienPi: string;
  /** Identité de cette machine de travail, annoncée au Pi — voir `client-lien-pi.ts`. */
  readonly machineId: string;
  readonly plafondRelancesDefaut?: number;
  /** H-75 : une fermeture terminale (secret invalide, epoch dépassé) n'est jamais retentée en interne — voir `client-lien-pi.ts`. */
  readonly surFermetureTerminale?: (fermeture: FermetureTerminale) => void;
  /**
   * Comptes Claude à sonder pour les jauges de rate limit. `☠` Ils vivent sur le
   * PC (`CLAUDE_CONFIG_DIR`) : le Pi ne peut PAS les lire. Absents ⇒ jauges non
   * mesurées, ce qui est honnête — mais c'est ce qui les laissait à 0 % en
   * permanence jusqu'au 23/07.
   */
  readonly comptesASonder?: readonly { readonly id: string; readonly configDir: string }[];
}

export interface SuperviseurPcAssemble {
  readonly superviseur: SuperviseurWorkers;
  readonly lien: LienWebSocket;
  readonly recepteurControle: RecepteurControlePc;
  arreter(): void;
}

/**
 * Construit le superviseur PC complet et le connecte au Pi. `connecter()` est
 * appelé ici (pas laissé à l'appelant) : H-75 exige une reconnexion
 * automatique dès le lancement du process, jamais une connexion différée à un
 * geste manuel.
 */
export function assemblerSuperviseurPc(options: OptionsAssemblageSuperviseurPc): SuperviseurPcAssemble {
  const persistance = new PersistanceRegistreSqlite({ chemin: options.cheminRegistrePersistance });
  const compteurRelances = new CompteurRelances(options.plafondRelancesDefaut);
  const jugeBoucle = creerJugeHaiku();

  const superviseur = new SuperviseurWorkers({
    compteurRelances,
    persistance,
    jugeBoucle,
    ...(options.comptesASonder ? { comptesASonder: options.comptesASonder } : {}),
  });

  // Dette n°1 : SANS cet appel, un redémarrage du PC repart avec un registre
  // vide alors que des workers peuvent encore tourner sur disque (H-74). Le
  // boot_id (H-75) est déjà pris en compte par `restaurer()` en amont
  // (`superviseur/identite-boot.ts`) — rien à composer ici en plus.
  superviseur.restaurer();
  log.info({ cheminRegistrePersistance: options.cheminRegistrePersistance }, 'registre PC restauré au démarrage (dette n°1 + boot_id, H-74/H-75)');

  const lien = creerClientLienPi({
    urlPi: options.urlPi,
    secret: options.secretLienPi,
    machineId: options.machineId,
    surFermetureTerminale: options.surFermetureTerminale,
  });
  // `☠` L'assembleur est LE point où un worker reçoit son port d'audit. Le Pi
  // n'envoie que des données (voir `ParametresSpecTransportables`) : sans ce
  // réassemblage, un worker démarrerait sans audit — protection silencieusement
  // absente (H-74). `construireWorkerSpec` exige le port en paramètre, ce qui
  // rend l'oubli impossible.
  const recepteurControle = cablerRecepteurControlePc(superviseur, lien, {
    assemblerSpec: (parametres) =>
      construireWorkerSpec(
        parametres,
        () => {
          const collecteur = new CollecteurAuditPermissions();
          return creerHooksAuditPermissions(collecteur);
        },
        // ☠ Les comptes de CETTE machine (H-44). Sans eux, un mandat routé vers
        // une autre machine que celle dont le Pi tient la liste démarre sur un
        // répertoire inexistant — mesuré le 01/08 sur le VPS.
        options.comptesASonder ?? [],
      ),
  });
  void lien.connecter();

  return {
    superviseur,
    lien,
    recepteurControle,
    arreter: (): void => lien.fermer(),
  };
}
