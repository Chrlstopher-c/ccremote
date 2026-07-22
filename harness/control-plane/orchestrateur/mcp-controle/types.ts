/**
 * Responsabilité : formes de données du serveur MCP de contrôle (branche A.2,
 * mission M-40). Aucune I/O ici.
 *
 * Deux familles de types :
 *  - le contrat de retour uniforme (A.2.3), imposé à tout outil ;
 *  - les ports vers les branches déléguées (E, F, C) dont les outils ont besoin.
 *
 * ☠ Aucun port ci-dessous n'implémente une action réelle sur un worker (B). La
 * frontière A↔B est délibérément inexistante (03-couche-1.md, table des six
 * frontières) : tout passe par ces ports. Leur implémentation réelle appartient
 * aux branches B/D, hors périmètre de la mission A.2 — même motif que
 * `control-plane/reconciliation/types.ts` (`InventairePc`, `ReinitialisateurSession`).
 */

import type { SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import type { FileEntreeCiblee, SourceInterruption } from '../../../pause/index.ts';
import type { Verdict } from '../../bus-permissions/index.ts';

/**
 * `'accepte'` ≠ `'applique'` (A.2.3) : le premier dit « pris en compte, pas
 * terminé », le second dit « fait ». C'est cette distinction qui empêche
 * l'orchestrateur de croire qu'un travail long est fini.
 *
 * `'differe'` existe dès cette version, mais aucun outil ne l'émet encore pour
 * une action réellement dispatchée (H-61 : la création d'équipe attend une
 * autorisation humaine explicite, non implémentée ici — voir `outils-cycle-vie.ts`).
 * La valeur est prête à être réutilisée sans refonte du contrat le jour où
 * l'autorisation humaine est câblée.
 */
export type EffetOutil = 'applique' | 'accepte' | 'refuse' | 'differe';

/** Contrat de retour uniforme (A.2.3). Tout outil le retourne, jamais une exception (A.2.4). */
export interface ContratRetour {
  readonly ok: boolean;
  readonly intention: string;
  readonly effet: EffetOutil;
  /** Id de suivi pour un effet asynchrone (`accepte`) ou une proposition (`differe`). */
  readonly ref?: string;
  /** État APRÈS l'opération, résumé court — évite un aller-retour de lecture. */
  readonly etat?: string;
  /** Obligatoire quand `effet === 'refuse'`. */
  readonly raison?: string;
}

// ---------------------------------------------------------------------------
// Ports — ce que ce module attend d'une équipe vivante (B/D, hors périmètre)
// ---------------------------------------------------------------------------

/**
 * Ce qu'un outil mutatif peut atteindre sur une équipe vivante. Réutilise les
 * formes déjà publiques de `pause/` (mêmes signatures que `FileEntreeCiblee` et
 * `SourceInterruption`) plutôt que d'en dupliquer une troisième version —
 * l'implémentation réelle appartient à B, mais la FORME est déjà stable.
 */
export interface CibleEquipe extends FileEntreeCiblee, SourceInterruption {}

/** Résout la cible d'une mission active. `null` = mission inconnue ou plus vivante. */
export interface RepertoireCibles {
  cible(missionId: string): CibleEquipe | null;
}

/** Port de fin de vie (F puis B, A.2.2) — libère le worktree, termine le worker. */
export interface ArreteurMission {
  arreter(missionId: string): Promise<void>;
}

/** Port de relance après crash (B, `resume`, A.2.2). */
export interface RelanceurMission {
  relancer(missionId: string, sessionId: string): Promise<void>;
}

/** Sous-ensemble de `MachineEtatsDemandes` (C) dont l'arbitrage délégué a besoin. */
export interface ArbitreEscalade {
  repondre(requestId: string, verdict: Verdict): boolean;
}

/** Sous-ensemble de `MachineEtatsDemandes` (C) dont l'inspection a besoin. */
export interface LecteurEscalades {
  enAttente(): ReadonlyArray<{
    readonly requestId: string;
    readonly outil: string;
    readonly idWorker: string;
    readonly enAttenteDepuisA: number | null;
  }>;
}

/** Port de garde-fou (G) — plafond par mission, filet de dernier recours (H-68). */
export interface DefinisseurBudget {
  definir(missionId: string, maxUsd: number): Promise<void>;
}

export type { SDKUserMessage };
