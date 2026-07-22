// Contrat du superviseur de workers (branche B) vu par le harness.
// Le PC fait autorité sur ce qui tourne (B.1.4) : `inventaire()` est la vérité.

export type IdWorker = string;

export interface DemandeSpawn {
  readonly worktree: string;
  readonly sessionId: string;
  /** Epoch attribué par le Pi au rattachement (D.2.3). */
  readonly epoch: number;
}

export interface DescripteurWorker {
  readonly id: IdWorker;
  readonly worktree: string;
  readonly sessionId: string;
  readonly epoch: number;
  readonly vivant: boolean;
  readonly exitCode: number | null;
  readonly signalCode: string | null;
  /**
   * `false` quand le worker est mort sans que stderr ait été rapatrié —
   * c'est l'« exit nu » de B.1.5 : le crash est muet.
   */
  readonly stderrRapatrie: boolean;
}

export interface SuperviseurWorkers {
  spawner(demande: DemandeSpawn): DescripteurWorker;
  inventaire(): readonly DescripteurWorker[];
  /** Mort brutale, sans fenêtre de grâce. Émet un exit nu si stderr n'est pas rapatrié. */
  tuerSansPreavis(id: IdWorker): void;
  /** `close()` : fermeture de stdin puis grâce. Voie par défaut (B.1.5). */
  arreterProprement(id: IdWorker): void;
  stderrDe(id: IdWorker): readonly string[];
  /** Workers vivants sur ce worktree. Plus d'un ⇒ panne #2 matérialisée. */
  workersSurWorktree(worktree: string): readonly DescripteurWorker[];
}
