// Contrat du bus de permissions (branche C) vu par le harness.
// Six états de C.2.1. `repondue` ≠ `confirmee` : l'écart est exactement
// l'endroit où se cache l'agent bloqué (invariant I-5).

export type EtatDemande =
  | 'recue'
  | 'resolue_auto'
  | 'en_attente'
  | 'repondue'
  | 'confirmee'
  | 'caduque';

export type Verdict =
  | { readonly behavior: 'allow'; readonly updatedInput?: Readonly<Record<string, unknown>> }
  | { readonly behavior: 'deny'; readonly message: string; readonly interrupt?: boolean };

export interface EntreeDemande {
  readonly requestId: string;
  readonly idWorker: string;
  readonly outil: string;
  readonly decisionReason?: string;
  readonly blockedPath?: string;
  readonly agentId?: string;
}

export interface DemandePermission extends EntreeDemande {
  readonly etat: EtatDemande;
  readonly verdict: Verdict | null;
  readonly recueA: number;
  readonly repondueA: number | null;
  readonly confirmeeA: number | null;
  /**
   * `true` quand `canUseTool` a retourné `null` sans confirmation d'envoi
   * hors-bande : l'appel d'outil est bloqué pour toujours (panne #24).
   */
  readonly bloqueeIndefiniment: boolean;
}

export interface BusPermissions {
  /** Première arrivée d'une demande. Escalade si non résolue par le lead. */
  recevoir(entree: EntreeDemande): void;
  /**
   * Redélivrance après coupure (`reinitialize()` ou `initialize`).
   * Doit être idempotente par `requestId` — sinon panne #25.
   */
  redelivrer(entree: EntreeDemande): void;
  repondre(requestId: string, verdict: Verdict): void;
  /** Le worker a repris : `repondue` → `confirmee`. */
  confirmer(requestId: string): void;
  /** Tour avorté / worker mort : `en_attente` → `caduque` (C.4.3). */
  rendreCaduque(requestId: string): void;
  demande(requestId: string): DemandePermission | undefined;
  enAttente(): readonly DemandePermission[];
  notificationsEmises(): number;
  /** Balayage I-5 : `repondue` sans `confirmee` au-delà du seuil ⇒ alertes. */
  balayer(seuilMs: number): readonly string[];
}
