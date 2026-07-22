/**
 * Responsabilité : construire la pause et la reprise d'un worker (B.4, H-46, mission M-33).
 *
 * `☠` Il n'existe aucune primitive de suspension native — ce contrôleur EST la construction.
 * Mécanique imposée par B.4, respectée à la lettre :
 *
 *  1. Marquer l'équipe `en_pause` dans le registre **avant** d'interrompre — sinon une
 *     course fait repartir un message en file.
 *  2. `interrupt()`. Le reçu lu est **exclusivement** la valeur de retour de cette promesse
 *     — jamais une inspection de la file après coup. C'est ce qui garantit l'acceptation
 *     (b) : sur une interruption propre, le reçu est écrit **avant** le `SDKResultMessage`
 *     du tour interrompu, et la boucle démarre le tour suivant immédiatement après —
 *     inspecter la file plus tard perd toujours la course contre le drainage.
 *  3. Retenir toute nouvelle entrée localement : tant que la pause est active, `envoyer()`
 *     tamponne au lieu de pousser dans la cible (le générateur d'entrée réel).
 *  4. Reprise : lever le drapeau, puis relâcher la retenue dans l'ordre de dépôt. Ne
 *     **jamais** renvoyer un message qui figure dans `still_queued` du dernier reçu — ces
 *     messages ont déjà été transmis au SDK avant l'interruption et s'exécuteront d'eux-
 *     mêmes ; les renvoyer produirait un tour dupliqué. Cette règle est respectée par
 *     construction ici : la retenue ne contient jamais de message déjà transmis (voir
 *     `envoyer`), donc aucun message flushé ne peut coïncider avec `still_queued`.
 *
 * ☠ LE POINT LE PLUS IMPORTANT DE LA MISSION — le mode dégradé (capacité
 * `interrupt_receipt_v1` absente, ou capacité annoncée mais `interrupt()` résolvant quand
 * même `undefined`) n'est PAS un cas théorique de fin de liste : mesuré en réel, le tableau
 * `capabilities` revient souvent vide. C'est probablement le chemin nominal. Sa sûreté ne
 * repose donc sur AUCUNE information tirée du reçu : la garantie « ni perdue ni dupliquée »
 * tient uniquement à ce que ce contrôleur ne touche jamais aux messages déjà transmis au
 * SDK (ni en mode normal ni en mode dégradé) et ne retransmet jamais un message qu'il a
 * déjà transmis lui-même. Le reçu — quand il existe — n'est qu'un instrument d'audit et de
 * décision de coupure future, jamais une condition de correction.
 */

import { randomUUID } from 'node:crypto';
import type { SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import type { Logger } from 'pino';
import { hasCapability } from '../workers/start-worker.ts';
import type { WorkerCapabilities } from '../workers/types.ts';
import { pauseSessionLogger } from './logger.ts';
import { partitionnerStillQueued } from './partition.ts';
import type {
  EtatPause,
  FileEntreeCiblee,
  PartitionStillQueued,
  RecuInterruption,
  RegistrePauseAdapter,
  SourceInterruption,
} from './types.ts';

/** Capacité vérifiée dans `SDKSystemMessage.capabilities` — jamais déduite d'une version (H-46, 01). */
export const CAPACITE_RECU_INTERRUPTION = 'interrupt_receipt_v1';

export class ControleurPauseError extends Error {
  override readonly name = 'ControleurPauseError';
}

export interface OptionsControleurPause {
  readonly sessionId: string;
  readonly source: SourceInterruption;
  readonly cible: FileEntreeCiblee;
  readonly capacites: WorkerCapabilities;
  /** Best-effort (H-15) : absent en test unitaire pur, présent en intégration avec E.1. */
  readonly registre?: RegistrePauseAdapter;
  readonly journal?: Logger;
}

export class ControleurPause {
  readonly #sessionId: string;
  readonly #source: SourceInterruption;
  readonly #cible: FileEntreeCiblee;
  readonly #capacites: WorkerCapabilities;
  readonly #registre: RegistrePauseAdapter | undefined;
  readonly #log: Logger;

  #etat: EtatPause = 'active';
  #retenue: SDKUserMessage[] = [];
  #uuidsTransmis = new Set<string>();
  #dernierRecu: RecuInterruption | undefined;

  constructor(options: OptionsControleurPause) {
    this.#sessionId = options.sessionId;
    this.#source = options.source;
    this.#cible = options.cible;
    this.#capacites = options.capacites;
    this.#registre = options.registre;
    this.#log = options.journal ?? pauseSessionLogger(options.sessionId);
  }

  get etat(): EtatPause {
    return this.#etat;
  }

  get enPause(): boolean {
    return this.#etat === 'en_pause';
  }

  /** Nombre de messages tamponnés localement, en attente de la reprise. */
  get enAttente(): number {
    return this.#retenue.length;
  }

  get dernierRecu(): RecuInterruption | undefined {
    return this.#dernierRecu;
  }

  /**
   * Envoie un message. En pause, il est retenu localement plutôt que transmis — c'est
   * l'étape 3 de la mécanique. Chaque message transmis (immédiatement ou plus tard, au
   * flush de `reprendre`) reçoit un `uuid` s'il n'en portait pas déjà, pour permettre
   * l'audit du prochain reçu via `evaluerRecu`.
   */
  async envoyer(message: SDKUserMessage): Promise<void> {
    if (this.#etat === 'en_pause') {
      this.#retenue.push(message);
      this.#log.debug({ enAttente: this.#retenue.length }, 'message retenu pendant la pause');
      return;
    }
    await this.#transmettre(message);
  }

  /**
   * Étapes 1-2 de la mécanique de pause. Idempotent : appeler en pause ne relance rien
   * (H-57 : « idempotentes, rejouables sans effet double — appuyer deux fois n'aggrave rien »).
   */
  async mettreEnPause(): Promise<RecuInterruption> {
    if (this.#etat === 'en_pause') {
      this.#log.debug({}, 'mettreEnPause ignoré : déjà en pause');
      return this.#dernierRecu ?? { degrade: true, stillQueued: [] };
    }

    // Étape 1 — marquer AVANT d'interrompre, sinon une course fait repartir un message en file.
    await this.#registre?.marquerEnPause(this.#sessionId);
    this.#etat = 'en_pause';

    // Étape 2 — la SEULE lecture légitime du reçu : la valeur de retour de interrupt().
    // Ne jamais, après cet appel, aller inspecter le flux de messages pour "vérifier" la
    // file — c'est exactement l'erreur que l'acceptation (b) interdit.
    const brut = await this.#source.interrupt();
    const recu = this.#normaliserRecu(brut);
    this.#dernierRecu = recu;

    if (recu.degrade) {
      this.#log.warn(
        { capaciteAnnoncee: hasCapability(this.#capacites, CAPACITE_RECU_INTERRUPTION) },
        'reçu d\'interruption dégradé : aucune garantie sur still_queued, mode sûr par construction',
      );
    } else {
      this.#log.info({ stillQueued: recu.stillQueued }, 'équipe mise en pause, reçu reçu');
    }
    return recu;
  }

  /**
   * Étape 4 — lève le drapeau puis relâche la retenue, strictement dans l'ordre de dépôt.
   * `☠` Ne filtre jamais sur `still_queued` : ces UUID désignent des messages déjà transmis
   * au SDK avant l'interruption, la retenue ne contient par construction que des messages
   * jamais transmis. Les deux ensembles sont disjoints par construction, pas par vérification.
   */
  async reprendre(): Promise<void> {
    if (this.#etat === 'active') {
      this.#log.debug({}, 'reprendre ignoré : déjà active');
      return;
    }
    this.#etat = 'active';
    await this.#registre?.marquerActive(this.#sessionId);

    const aLiberer = this.#retenue;
    this.#retenue = [];
    for (const message of aLiberer) {
      await this.#transmettre(message);
    }
    this.#log.info({ relaches: aLiberer.length }, 'équipe reprise, retenue relâchée');
  }

  /**
   * Audit best-effort du dernier reçu contre les UUID réellement transmis par ce
   * contrôleur. Acceptation (c) : un UUID absent de `uuidsTransmis` est journalisé, jamais
   * traité comme une erreur — voir `partitionnerStillQueued`.
   */
  evaluerRecu(): PartitionStillQueued {
    const recu = this.#dernierRecu;
    if (recu === undefined || recu.degrade) return { connus: [], inconnus: [] };
    const partition = partitionnerStillQueued(recu.stillQueued, this.#uuidsTransmis);
    if (partition.inconnus.length > 0) {
      this.#log.debug(
        { inconnus: partition.inconnus },
        'UUID inconnus dans still_queued — ignorés, pas une erreur (acceptation c)',
      );
    }
    return partition;
  }

  async #transmettre(message: SDKUserMessage): Promise<void> {
    const estampille: SDKUserMessage = message.uuid === undefined ? { ...message, uuid: randomUUID() } : message;
    if (estampille.uuid !== undefined) this.#uuidsTransmis.add(estampille.uuid);
    await this.#cible.envoyerMessage(estampille);
  }

  #normaliserRecu(brut: { still_queued: string[] } | undefined): RecuInterruption {
    const capaciteAnnoncee = hasCapability(this.#capacites, CAPACITE_RECU_INTERRUPTION);
    if (!capaciteAnnoncee) {
      return { degrade: true, stillQueued: [] };
    }
    if (brut === undefined) {
      // Capacité annoncée mais promesse résolue à `undefined` : incohérence du binaire,
      // pas une raison de faire confiance à une liste qui n'existe pas.
      return { degrade: true, stillQueued: [] };
    }
    return { degrade: false, stillQueued: [...brut.still_queued] };
  }
}
