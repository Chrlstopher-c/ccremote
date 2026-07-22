/**
 * Responsabilité : formes de données du registre d'état (E.1.1, E.1.3).
 * Aucune I/O ici — uniquement les types du domaine « registre ».
 */

/**
 * États rapportés par le worker (Découverte 2, E.1.1). Autorité : le PC.
 * ☠ Ne JAMAIS fusionner avec EtatHarness dans un seul champ (panne #30).
 */
export type EtatSdk = 'idle' | 'running' | 'requires_action';

/**
 * États décidés par le control plane (E.1.1). Autorité : le Pi.
 * `planifiee` / `en_cours` / `annulee` complètent la liste de E.1.1 : le champ
 * est NOT NULL et doit couvrir tout le cycle de vie, y compris avant spawn.
 * `en_cours` ≠ `running` : le Pi considère la mission dispatchée et vivante,
 * le SDK oscille running/idle à chaque tour.
 */
export type EtatHarness =
  | 'planifiee'
  | 'en_cours'
  | 'en_pause'
  | 'attente_machine'
  | 'echec_definitif'
  | 'terminee'
  | 'annulee';

/** États harness considérés comme occupant le projet (H-56 : une seule mission active par projet). */
export const ETATS_HARNESS_ACTIFS: readonly EtatHarness[] = [
  'planifiee',
  'en_cours',
  'en_pause',
  'attente_machine',
] as const;

/** États harness terminaux — `terminee` est le cas NOMINAL (F2.0.1). */
export const ETATS_HARNESS_TERMINAUX: readonly EtatHarness[] = [
  'echec_definitif',
  'terminee',
  'annulee',
] as const;

export type OrigineTransition = 'sdk' | 'harness';

/** Fenêtres de rate limit exposées par SDKRateLimitInfo (H-54). Chaîne libre : la liste bouge. */
export type TypeFenetreQuota = string;

export type StatutQuota = 'allowed' | 'allowed_warning' | 'rejected';

/**
 * Un lot = l'ensemble des missions issues d'une même intention utilisateur (F2.1.4).
 * En v1 un lot ne porte qu'une mission (H-56) ; la structure est conservée pour
 * le parallélisme futur — l'ajouter après coup serait une migration.
 */
export interface Lot {
  readonly id: string;
  readonly intention: string;
  readonly origine: string | null;
  readonly creeA: number;
  readonly closA: number | null;
}

export interface CreationLot {
  readonly id: string;
  readonly intention: string;
  readonly origine?: string | null;
}

/** Compte Claude Code isolé par CLAUDE_CONFIG_DIR (H-53). */
export interface Compte {
  readonly id: string;
  readonly configDir: string;
  readonly email: string | null;
  readonly organisation: string | null;
  readonly typeAbonnement: string | null;
  readonly fournisseurApi: string | null;
  readonly actif: boolean;
  readonly creeA: number;
  readonly majA: number;
}

export interface CreationCompte {
  readonly id: string;
  readonly configDir: string;
  readonly email?: string | null;
  readonly organisation?: string | null;
  readonly typeAbonnement?: string | null;
  readonly fournisseurApi?: string | null;
  readonly actif?: boolean;
}

/** Instantané de quota par (compte, fenêtre), dernier-gagne (H-54). */
export interface Quota {
  readonly compteId: string;
  readonly typeFenetre: TypeFenetreQuota;
  readonly statut: StatutQuota;
  readonly resetA: number | null;
  readonly utilisation: number | null;
  readonly statutOverage: string | null;
  readonly utiliseOverage: boolean | null;
  readonly seuilDepasse: string | null;
  readonly observeA: number;
}

export interface RelevéQuota {
  readonly compteId: string;
  readonly typeFenetre: TypeFenetreQuota;
  readonly statut: StatutQuota;
  readonly resetA?: number | null;
  readonly utilisation?: number | null;
  readonly statutOverage?: string | null;
  readonly utiliseOverage?: boolean | null;
  readonly seuilDepasse?: string | null;
  readonly observeA?: number;
}

/** Mission instanciée, jetable, à but borné (F2.0.1). */
export interface Mission {
  readonly id: string;
  readonly lotId: string;
  readonly nom: string;
  readonly projet: string;
  readonly worktree: string | null;
  readonly branche: string | null;
  readonly sessionId: string | null;
  readonly compteId: string;
  readonly mandat: string | null;
  readonly critereArret: string | null;
  readonly modeleDemande: string | null;
  readonly modeleResolu: string | null;
  /** Autorité : le worker (PC). */
  readonly etatSdk: EtatSdk | null;
  readonly etatSdkMajA: number | null;
  /** Autorité : le control plane (Pi). */
  readonly etatHarness: EtatHarness;
  readonly etatHarnessMajA: number;
  readonly epoch: number;
  readonly highWaterMark: number;
  readonly budgetMaxUsd: number | null;
  readonly budgetConsommeUsd: number;
  readonly contexteTokensUtilises: number | null;
  readonly contexteTokensMax: number | null;
  readonly compteurRelances: number;
  readonly derniereRaisonTerminale: string | null;
  readonly creeA: number;
  readonly demarreeA: number | null;
  readonly termineeA: number | null;
}

export interface CreationMission {
  readonly id: string;
  readonly lotId: string;
  readonly nom: string;
  readonly projet: string;
  readonly compteId: string;
  readonly worktree?: string | null;
  readonly branche?: string | null;
  readonly sessionId?: string | null;
  readonly mandat?: string | null;
  readonly critereArret?: string | null;
  readonly modeleDemande?: string | null;
  readonly modeleResolu?: string | null;
  readonly budgetMaxUsd?: number | null;
}

/** Historique des transitions — `origine` préserve la distinction même a posteriori. */
export interface Transition {
  readonly id: number;
  readonly missionId: string;
  readonly origine: OrigineTransition;
  readonly etatPrecedent: string | null;
  readonly etatNouveau: string;
  readonly motif: string | null;
  readonly survenuA: number;
}

/** Capacité annoncée par SDKSystemMessage.capabilities (E.5). Parc hétérogène assumé. */
export interface Capacite {
  readonly missionId: string;
  readonly capacite: string;
  readonly presente: boolean;
  readonly observeA: number;
}

/** Vue « où en est ce que j'ai demandé hier soir ? » (F2.0.1). */
export interface AvancementLot {
  readonly lot: Lot;
  readonly missions: readonly Mission[];
  readonly total: number;
  readonly actives: number;
  readonly terminees: number;
  readonly echecs: number;
}
