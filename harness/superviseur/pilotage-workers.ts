/**
 * Responsabilité : les trois ordres que l'opérateur adresse à une mission
 * VIVANTE — instruction, pause, reprise. Extrait de `superviseur-workers.ts`
 * pour ne pas franchir la limite de 500 lignes.
 *
 * `☠ CE QUI MANQUAIT` — `ControleurPause` (`pause/`) était écrit, testé, et
 * référencé par AUCUN worker : sixième occurrence du même défaut sur ce projet
 * (voir `TODO.md`). Ce fichier est le premier appelant réel.
 *
 * `☠` Toute instruction passe par le contrôleur de pause, jamais directement
 * par la file d'entrée. C'est ce qui donne son sens à la pause : un message
 * envoyé pendant une pause est RETENU localement et transmis à la reprise, au
 * lieu d'être injecté dans un agent qu'on croyait arrêté. Court-circuiter le
 * contrôleur « parce que c'est plus direct » annulerait toute la mécanique.
 */

import type { SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { construireMessageUtilisateur } from '../control-plane/orchestrateur/entree/index.ts';
import { ControleurPause } from '../pause/index.ts';
import type { FileEntreeCiblee, SourceInterruption } from '../pause/index.ts';
import type { WorkerCapabilities } from '../workers/types.ts';
import { missionLogger } from './logger.ts';

/** Ce dont le pilotage a besoin d'un enregistrement de worker, et rien de plus. */
export interface CibledePilotage {
  readonly sessionId: string;
  readonly vivant: boolean;
  readonly entree: FileEntreeCiblee;
  /** `query.interrupt()` du worker — c'est LUI qui suspend réellement l'agent. */
  readonly source: SourceInterruption;
  readonly capacites: WorkerCapabilities;
}

export class MissionNonPilotableError extends Error {
  constructor(missionId: string) {
    super(`mission ${missionId} inconnue ou déjà terminée — aucun ordre transmis`);
    this.name = 'MissionNonPilotableError';
  }
}

/**
 * Un contrôleur par worker, retenu tant que l'enregistrement vit.
 * `WeakMap` plutôt qu'une `Map` par `sessionId` : le contrôleur disparaît avec
 * le worker sans aucun code de nettoyage, donc sans fuite possible le jour où
 * quelqu'un oublie d'appeler ce nettoyage sur un chemin d'arrêt.
 */
const CONTROLEURS = new WeakMap<object, ControleurPause>();

function controleurDe(cible: CibledePilotage, cle: object): ControleurPause {
  const existant = CONTROLEURS.get(cle);
  if (existant !== undefined) return existant;
  const controleur = new ControleurPause({
    sessionId: cible.sessionId,
    source: cible.source,
    cible: cible.entree,
    capacites: cible.capacites,
  });
  CONTROLEURS.set(cle, controleur);
  return controleur;
}

function exiger(cible: CibledePilotage | null, missionId: string): CibledePilotage {
  // `☠` Un ordre adressé à une mission morte doit LEVER, jamais être absorbé en
  // silence : l'opérateur croirait sa mission en pause alors qu'elle est finie.
  if (cible === null || !cible.vivant) throw new MissionNonPilotableError(missionId);
  return cible;
}

export interface Pilotage {
  /** Transmet un message à l'agent. Retenu localement si la mission est en pause. */
  envoyerInstruction(missionId: string, texte: string): Promise<{ readonly retenue: boolean }>;
  mettreEnPause(missionId: string): Promise<{ readonly enPause: true }>;
  reprendre(missionId: string): Promise<{ readonly enAttenteTransmis: number }>;
  /**
   * Coupe le tour en cours et rend la main à l'agent — SANS entrer en pause :
   * ce qui arrive ensuite lui est transmis normalement.
   */
  interrompre(missionId: string): Promise<void>;
  enPause(missionId: string): boolean;
}

/**
 * `resoudre` rend la cible ET la clé d'identité du worker (l'objet
 * d'enregistrement lui-même), pour que le contrôleur de pause suive le worker
 * et non la mission — un `relancer` crée un nouveau worker, donc un nouvel
 * état de pause, ce qui est correct.
 */
export function creerPilotage(resoudre: (missionId: string) => { cible: CibledePilotage; cle: object } | null): Pilotage {
  const obtenir = (missionId: string): { controleur: ControleurPause; cible: CibledePilotage } => {
    const trouve = resoudre(missionId);
    const cible = exiger(trouve?.cible ?? null, missionId);
    return { controleur: controleurDe(cible, trouve!.cle), cible };
  };

  return {
    async envoyerInstruction(missionId, texte): Promise<{ readonly retenue: boolean }> {
      if (texte.trim().length === 0) throw new RangeError('une instruction vide n’est jamais transmise');
      const { controleur, cible } = obtenir(missionId);
      const message: SDKUserMessage = construireMessageUtilisateur(texte, { sessionId: cible.sessionId });
      const avant = controleur.enAttente;
      await controleur.envoyer(message);
      const retenue = controleur.enAttente > avant;
      missionLogger(missionId).info({ retenue }, retenue ? 'instruction RETENUE (mission en pause)' : 'instruction transmise');
      return { retenue };
    },

    async mettreEnPause(missionId): Promise<{ readonly enPause: true }> {
      const { controleur } = obtenir(missionId);
      await controleur.mettreEnPause();
      missionLogger(missionId).info({}, 'mission mise en pause par l’opérateur (H-57)');
      return { enPause: true };
    },

    async reprendre(missionId): Promise<{ readonly enAttenteTransmis: number }> {
      const { controleur } = obtenir(missionId);
      const enAttente = controleur.enAttente;
      await controleur.reprendre();
      missionLogger(missionId).info({ enAttenteTransmis: enAttente }, 'mission reprise, messages retenus transmis');
      return { enAttenteTransmis: enAttente };
    },

    /**
     * `☠` Passe par la source d'interruption du worker, PAS par le contrôleur de
     * pause : interrompre n'est pas mettre en pause. Une mission déjà en pause
     * n'a rien à couper — l'interruption y est un no-op, dit comme tel plutôt
     * que réveillant l'agent par un chemin détourné.
     */
    async interrompre(missionId): Promise<void> {
      const { controleur, cible } = obtenir(missionId);
      if (controleur.enPause) {
        missionLogger(missionId).info({}, 'interruption ignorée : mission déjà en pause, aucun tour à couper');
        return;
      }
      await cible.source.interrupt();
      missionLogger(missionId).info({}, 'tour interrompu par le control plane (A.2.2)');
    },

    enPause(missionId): boolean {
      const trouve = resoudre(missionId);
      if (trouve === null || !trouve.cible.vivant) return false;
      return controleurDe(trouve.cible, trouve.cle).enPause;
    },
  };
}
