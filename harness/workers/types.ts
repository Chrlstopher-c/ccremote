/**
 * Responsabilité : formes de données du domaine « worker » (B.1.1).
 * Un worker = un processus hébergeant une session Agent SDK, dédié à une équipe,
 * attaché à un worktree. Il ne connaît pas le parc.
 */

import type {
  Options,
  Query,
  SDKUserMessage,
  SettingSource,
  SpawnOptions,
  SpawnedProcess,
} from '@anthropic-ai/claude-agent-sdk';

/** Familles de modèles reconnues par le plancher (H-43). */
export type ModelTier = 'haiku' | 'sonnet' | 'opus' | 'fable';

/** Résultat de la résolution d'alias — jamais l'alias brut (☠ H-43 sur `inherit`). */
export interface ResolvedModel {
  /** Ce qui a été demandé : alias (`inherit`, `sonnet`…) ou identifiant complet. */
  readonly requested: string;
  /** Modèle effectivement transmis au SDK, après résolution de `inherit`. */
  readonly resolved: string;
  /** Famille déduite du modèle résolu, base de la comparaison au plancher. */
  readonly tier: ModelTier;
  /** `true` si `requested` était un alias d'héritage résolu via les settings. */
  readonly viaInheritance: boolean;
}

/** Motifs d'échec du pré-vol, stables et testables (B.1.2 étape 1). */
export type PreflightFailureCode =
  | 'setting_sources_empty'
  | 'project_source_missing'
  | 'settings_cascade_empty'
  | 'machine_claude_md_missing'
  | 'resolve_settings_failed';

export interface PreflightFailure {
  readonly code: PreflightFailureCode;
  readonly detail: string;
}

/** Rapport de pré-vol. `ok === false` ⇒ **ne pas spawner**, remonter au Pi. */
export interface PreflightReport {
  readonly ok: boolean;
  readonly cwd: string;
  /** Tiers de settings réellement chargés depuis le disque. */
  readonly loadedSources: readonly SettingSource[];
  /** Chemin du CLAUDE.md machine (tier `user`) quand il est visible. */
  readonly machineClaudeMdPath: string | null;
  /** Chemins des CLAUDE.md de projet trouvés en remontant depuis `cwd`. */
  readonly projectClaudeMdPaths: readonly string[];
  /** `model` effectif de la cascade — source de résolution de `inherit`. */
  readonly effectiveModel: string | null;
  readonly failures: readonly PreflightFailure[];
}

/** Capacités annoncées par le binaire — jamais déduites d'un numéro de version. */
export interface WorkerCapabilities {
  /** Contenu brut de `SDKSystemMessage.capabilities` (ensemble ouvert). */
  readonly advertised: readonly string[];
  /** Informatif uniquement. Interdit d'en dériver une capacité (panne #37). */
  readonly claudeCodeVersion: string;
  readonly tools: readonly string[];
  readonly model: string;
  readonly sessionId: string;
}

/** Ce que le Pi impose à un worker. Tout le reste appartient au PC (H-44). */
export interface WorkerSpec {
  /** Fixé par le Pi, jamais auto-généré (B.1.1). */
  readonly sessionId: string;
  /** Worktree de l'équipe (H-11). */
  readonly cwd: string;
  /** Mandat de l'équipe, ajouté au preset `claude_code` (H-52). */
  readonly mandate: string;
  /** Plancher de déni, motifs **scopés** (H-41, panne #21). Champ obligatoire. */
  readonly deniedToolPatterns: readonly string[];
  /** Anti-boucle par mission (H-58). */
  readonly maxBudgetUsd: number;
  /** Alias ou identifiant de modèle ; résolu puis comparé au plancher (H-43). */
  readonly model?: string;
  /** Répertoire de config du compte Claude Code à utiliser (H-53). */
  readonly configDir?: string;
  /** Agent Teams (N2), expérimental, par équipe (H-14). */
  readonly agentTeams?: boolean;
  /** Variables additionnelles ; fusionnées **au-dessus** de `process.env`. */
  readonly extraEnv?: Readonly<Record<string, string>>;
  /** Adaptateur de miroir vers le Pi (E.3). Best-effort par conception (H-15). */
  readonly sessionStore?: Options['sessionStore'];
  /** Point d'extension distant (B.2.1). Absent ⇒ spawn local intégré du SDK. */
  readonly spawnProcess?: (options: SpawnOptions) => SpawnedProcess;
  /** Capture stderr — seul canal de diagnostic (B.2.3). */
  readonly onStderr?: (data: string) => void;
}

/** Poignée rendue par le démarrage. L'annonce au Pi appartient à l'appelant. */
export interface WorkerHandle {
  readonly sessionId: string;
  readonly cwd: string;
  readonly capabilities: WorkerCapabilities;
  readonly model: ResolvedModel;
  readonly preflight: PreflightReport;
  /** `☠` conservé en closure : arrêt immédiat, sans fenêtre de grâce (B.2.2). */
  readonly abortController: AbortController;
  /** Flux SDK, déjà positionné après le message `init`. */
  readonly query: Query;
}

/** Signature de `query()` du SDK, isolée pour l'injection en test. */
export type QueryFn = (params: {
  prompt: string | AsyncIterable<SDKUserMessage>;
  options?: Options;
}) => Query;
