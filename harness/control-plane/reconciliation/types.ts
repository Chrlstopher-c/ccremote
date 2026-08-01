/**
 * Responsabilité : formes de données et ports du domaine « réconciliation »
 * (E.1.4, A.4.2, D.2.4 — mission M-30).
 *
 * Principe directeur (E.1.4, H-15) : « le registre du Pi n'est pas l'autorité sur ce qui
 * tourne — le PC l'est ». Cette réconciliation applique cette règle MÉCANIQUEMENT : l'état
 * harness d'une mission est recalculé à partir du seul fait « vivant » rapporté par le PC,
 * jamais l'inverse. Il n'existe aucun chemin de code où une croyance du Pi contredisant le
 * PC survit à un passage de réconciliation — voir `reconciliation.ts`.
 *
 * Ports (interfaces), pas d'implémentation : le superviseur réel (branche B, `workers/`) et
 * la matérialisation réelle de `Query.reinitialize()` sont hors périmètre de cette mission —
 * scope_guard oblige. Ce module ne dépend que de ces contrats minimaux.
 */

/** Ce que le superviseur PC (branche B) expose au minimum sur un worker vivant ou mort. */
export interface DescripteurWorkerPc {
  readonly sessionId: string;
  readonly worktree: string | null;
  readonly epoch: number;
  readonly vivant: boolean;
}

/**
 * Port vers le superviseur réel (B.1.4 : « inventaire() fait autorité »).
 * Implémentation réelle hors périmètre M-30 — appartient à la branche B (`workers/`).
 */
export interface InventairePc {
  inventaire(): Promise<readonly DescripteurWorkerPc[]> | readonly DescripteurWorkerPc[];
  /** Best-effort : le worker peut déjà être mort au moment de l'appel. */
  tuerSansPreavis(sessionId: string): Promise<void> | void;
}

/** Sous-ensemble de `BusPermissions` (branche C) dont la réconciliation a besoin. */
export interface RedelivranceBusPermissions {
  redelivrer(entree: {
    readonly requestId: string;
    readonly idWorker: string;
    readonly outil: string;
  }): void;
}

export interface DemandeEnAttenteReinitialisation {
  readonly requestId: string;
  readonly outil: string;
}

/**
 * Ce que retourne `Query.reinitialize()` du SDK — les demandes de permission en attente
 * redevenues éligibles à la redélivrance (01-verification-sdk.md, Découverte 2 pt 8 ;
 * bus-permissions/machine-etats.ts, C.3.1 : « reinitialize() ou initialize avec
 * pending_permission_requests »).
 */
export interface ResultatReinitialisation {
  readonly demandesEnAttente: readonly DemandeEnAttenteReinitialisation[];
}

/**
 * Port vers `Query.reinitialize()` (D.2.4). `☠ CASSE` (panne #3 de la grille) — sans cet
 * appel, les permissions demandées pendant la coupure ne réatteignent jamais `canUseTool` et
 * l'équipe reste bloquée en paraissant saine. La réconciliation ne peut PAS s'en passer :
 * voir `reconciliation.ts#tenterReinitialiser`. L'implémentation réelle (appel du SDK sur le
 * worker rattaché) est hors périmètre de cette mission — branche B.
 */
export interface ReinitialisateurSession {
  reinitialiser(sessionId: string): Promise<ResultatReinitialisation>;
}

/** Libère le worktree d'une mission fantôme (F.2.3). Implémentation hors périmètre — branche F. */
export interface LibererWorktree {
  liberer(missionId: string, worktree: string): Promise<void> | void;
}

/** Remise à zéro du compteur de relances (branche relance, M-34) sur rattachement sain. */
export interface RemiseAZeroRelances {
  reinitialiser(sessionId: string): void;
}

export type DeclencheurReconciliation = 'demarrage' | 'reconnexion' | 'periodique';

export interface DependancesReconciliation {
  readonly inventairePc: InventairePc;
  readonly reinitialisateur: ReinitialisateurSession;
  readonly busPermissions?: RedelivranceBusPermissions;
  readonly libererWorktree?: LibererWorktree;
  readonly compteurRelances?: RemiseAZeroRelances;
  /**
   * Périmètre de la passe : quelles missions actives cet inventaire est-il en
   * droit de juger ? Absent ⇒ toutes (mono-machine, bancs, tests).
   *
   * `☠` INDISPENSABLE dès qu'il y a plus d'une machine de travail (migration
   * 22). `inventairePc` ne rapporte que les workers de SA machine : sans ce
   * filtre, toute mission vivant ailleurs serait « absente du PC », donc
   * marquée FANTÔME et terminée — y compris une équipe en plein travail sur une
   * autre machine. Le rapport nomme les missions écartées faute de machine
   * connue, pour que l'exclusion ne soit jamais silencieuse.
   */
  readonly concerne?: (mission: MissionReconciliable) => boolean;
}

/** Ce que le périmètre a besoin de connaître d'une mission — rien de plus. */
export interface MissionReconciliable {
  readonly id: string;
  readonly machine: string | null;
}

export interface RapportReconciliation {
  readonly fantomes: readonly string[];
  readonly orphelinsAdoptes: readonly string[];
  readonly orphelinsTues: readonly string[];
  readonly orphelinsIgnores: readonly string[];
  readonly divergencesCorrigees: readonly string[];
  readonly reinitialisationsReussies: readonly string[];
  readonly reinitialisationsEchouees: readonly string[];
  readonly permissionsOrphelines: readonly string[];
  /**
   * Missions actives écartées du périmètre faute de machine connue (`machine`
   * à `NULL`, antérieures à la migration 22). `☠` Rapportées explicitement :
   * une mission que PERSONNE ne réconcilie resterait active pour toujours et
   * occuperait son projet (H-56). Le silence sur ce point serait exactement le
   * motif « l'absence ne dit rien » que ce dépôt paie régulièrement.
   */
  readonly horsPerimetre: readonly string[];
}
