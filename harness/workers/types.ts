/**
 * Responsabilité : formes de données du domaine « worker » (B.1.1).
 * Un worker = un processus hébergeant une session Agent SDK, dédié à une équipe,
 * attaché à un worktree. Il ne connaît pas le parc.
 */

import type {
  HookCallbackMatcher,
  HookEvent,
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
  /** Port de redélivrance vers le bus de permissions (H-73.1). Absent ⇒ refus par défaut. */
  readonly portBusPermissions?: PortBusPermissions;
  /**
   * Port vers le collecteur d'audit des permissions (C.5, M-22) — usine appelée
   * une fois à la composition (`workers/audit-hooks.ts`), qui rend les hooks
   * `Options.hooks` d'un collecteur dédié à ce worker. **Obligatoire** (H-74) :
   * c'est la 5e occurrence du même défaut mesurée le 2026-07-22
   * (`composeWorkerOptions` ne fixait jamais `options.hooks`) — un garde-fou
   * d'audit dont le câblage est optionnel s'éteint en silence et donne un faux
   * sentiment de couverture. Sans lui, `PreToolUse` — seule source exhaustive
   * en `permissionMode: 'auto'` (C.1.1, H-64) — n'est jamais branché, et
   * l'audit ne voit ni les appels auto-approuvés ni rien du tout : angle mort
   * total, pas partiel.
   */
  readonly portAuditPermissions: PortAuditPermissions;
}

/**
 * Usine construisant les entrées `Options.hooks` d'un worker, liées à un
 * collecteur d'audit dédié (`control-plane/audit-permissions`, M-22).
 * `workers/` ne dépend pas de `control-plane/` en dur (H-73.1 point 3,
 * code-standards.md) : l'appelant construit le collecteur et ses hooks via
 * `creerHooksAuditPermissions`, et n'injecte ici que la forme SDK publique.
 * Invoquée une fois par worker à la composition (`options-composition.ts`) —
 * jamais partagée entre workers, pour ne pas mélanger l'état d'audit de deux
 * missions distinctes.
 */
export type PortAuditPermissions = () => Partial<Record<HookEvent, HookCallbackMatcher[]>>;

/**
 * Ce que porte une demande atteignant `canUseTool` (H-73.1) : redélivrance après
 * coupure, ou l'une des trois exceptions C.1.2 qui traversent `permissionMode: 'auto'`.
 */
export interface DemandeCanUseTool {
  readonly requestId: string;
  readonly outil: string;
  /**
   * `☠` Les paramètres d'appel de l'outil. Sans eux, un arbitre ne peut pas
   * décider : « Bash » n'est pas une demande, `Bash({ command: 'rm -rf …' })`
   * en est une. Le plancher de déni (C.1.3) et l'audit (C.5) travaillent tous
   * deux sur le contenu de l'appel, jamais sur le seul nom de l'outil.
   * `unknown` et non `any` : la forme dépend de l'outil, c'est à l'arbitre de
   * la restreindre.
   */
  readonly input: unknown;
  readonly decisionReason?: string;
  readonly blockedPath?: string;
  readonly agentId?: string;
}

/**
 * Mirroir intentionnel de `control-plane/bus-permissions/types.ts` (`Verdict`) —
 * dupliqué plutôt qu'importé : `workers/` ne doit pas dépendre de `control-plane/`
 * en dur (H-73.1 point 3, code-standards.md : import ne traversant pas la frontière
 * de domaine sans passer par un port).
 */
export type VerdictCanUseTool =
  | { readonly behavior: 'allow'; readonly updatedInput?: Readonly<Record<string, unknown>> }
  | { readonly behavior: 'deny'; readonly message: string; readonly interrupt?: boolean };

/**
 * Port injecté vers la machine à états du bus de permissions (M-21,
 * `control-plane/bus-permissions/machine-etats.ts`). L'assemblage réel (quelle
 * instance, quel canal humain derrière) se fait hors de `workers/` — voir
 * `workers/can-use-tool.ts` pour le comportement par défaut en son absence.
 */
export type PortBusPermissions = (demande: DemandeCanUseTool) => Promise<VerdictCanUseTool>;

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
  /**
   * Capturé par le spawner local (`process-spawner.ts`) au moment du spawn.
   * `null` explicite si `spec.spawnProcess` était fourni par l'appelant (spawn
   * distant, B.2.1 — pas de pid local à capturer) ou si le spawn local n'a pas
   * pu livrer de pid. Jamais confondu avec une valeur par défaut (H-74, point 7).
   * Consommé par `superviseur/` pour la persistance du registre (dette n°1) —
   * `☠` le pid seul ne prouve rien (recyclage noyau), toujours coupler à
   * `pidStarttime`.
   */
  readonly pid: number | null;
  /**
   * `starttime` (22e champ de `/proc/<pid>/stat`) au moment du spawn, capturé
   * dans la même fenêtre que `pid`. `null` explicite (process déjà mort,
   * `/proc` indisponible, plateforme non Linux, ou spawn distant) — jamais une
   * chaîne vide qui se confondrait avec une vraie mesure.
   */
  readonly pidStarttime: string | null;
}

/** Signature de `query()` du SDK, isolée pour l'injection en test. */
export type QueryFn = (params: {
  prompt: string | AsyncIterable<SDKUserMessage>;
  options?: Options;
}) => Query;
