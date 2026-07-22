/**
 * Responsabilité : formes de données du superviseur de workers, côté PC (branche B,
 * D.3 — mission M-13).
 *
 * Ce module est le CORPS des ports déclarés comme contrats par d'autres missions :
 * `InventairePc` / `ReinitialisateurSession` (`control-plane/reconciliation/types.ts`,
 * M-30) et `RepertoireCibles` / `ArreteurMission` / `RelanceurMission`
 * (`control-plane/orchestrateur/mcp-controle/types.ts`, A.2). Il ne les redéfinit
 * jamais — il les importe et les implémente à la lettre (scope_guard).
 *
 * ☠ Frontière A↔B inexistante (03-couche-1.md) : ce module ignore tout du registre
 * SQLite du Pi (E.1). Il ne connaît que ce qu'on lui donne au démarrage d'un worker
 * (`DemandeDemarrage`) et ce qu'il observe lui-même (résultats de tour). Toute
 * decision qui a besoin du registre passe par un port injecté, jamais un import direct.
 */

import type { GenerateurEntree } from '../control-plane/orchestrateur/entree/index.ts';
import type { WorkerHandle, WorkerSpec } from '../workers/index.ts';
import type { DecisionRelance } from '../relance/types.ts';

export type { FileEntreeCiblee } from '../pause/index.ts';

/** Ce que le Pi fournit en plus du `WorkerSpec` au moment du dispatch (D.2.3, D.3.1). */
export interface DemandeDemarrage {
  readonly missionId: string;
  /** Epoch attribué par le Pi à ce rattachement (D.2.3) — stocké, pas arbitré ici (M-11). */
  readonly epoch: number;
  readonly spec: WorkerSpec;
  /**
   * Premier message utilisateur, mis en file avant le spawn (piège H-60 : un flux
   * silencieux n'émet jamais `init`). Jamais vide.
   */
  readonly promptInitial: string;
}

/**
 * Émis à chaque décision de la politique de relance (B.3, wiring M-13). Best-effort
 * (H-15) : la remontée réelle vers le Pi passe par le canal d'observation (E.2, hors
 * périmètre) — ce port n'ouvre aucune connexion, il notifie un appelant déjà présent
 * en mémoire du même process. Conforme à D.3.2 : le PC ne pousse rien lui-même.
 */
export interface ObservateurRelance {
  surDecision(missionId: string, decision: DecisionRelance): void;
}

/** Enregistrement interne d'un worker vivant ou récemment mort (survit à la mort pour permettre la relance). */
export interface EnregistrementWorker {
  readonly missionId: string;
  readonly sessionId: string;
  readonly epoch: number;
  readonly worktree: string;
  readonly spec: WorkerSpec;
  readonly handle: WorkerHandle;
  /**
   * Concret, pas la seule forme `FileEntreeCiblee` : `arreter()` a besoin de
   * `.fermer()` (A.1.2) en plus de `.envoyerMessage()` (A.2.2, `cible()`).
   */
  readonly entree: GenerateurEntree;
  vivant: boolean;
}
