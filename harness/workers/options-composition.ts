/**
 * Responsabilité : composer les `Options` d'un worker (B.1.3).
 *
 * Le harness ne fixe que le **structurel** : ce qu'il fixe écrase la config du
 * poste (H-44). Tout le reste — style de sortie, serveurs MCP du projet,
 * skills, plugins, thinking, effort — appartient au PC et n'apparaît pas ici.
 *
 * `options.hooks` (programmatique, JS, ce fichier) est **structurel** et
 * distinct des hooks locaux du poste (commandes shell dans `settings.json`,
 * H-44) : les deux mécanismes sont de forme différente dans le SDK et
 * coexistent (⚠ HYP — non exécuté en réel, déduit des types : deux champs
 * disjoints, `Options.hooks` en callbacks JS d'un côté, `hooks` de
 * `SettingsFileSchema` en commandes shell de l'autre — à revalider sur un banc
 * si un jour l'un semble supprimer l'autre). Ici, il porte exclusivement
 * l'audit de permissions (C.5, M-22, H-74) — jamais une customisation projet.
 */

import type { Options } from '@anthropic-ai/claude-agent-sdk';
import { assertRetryWatchdogCoherent } from '../budgets/index.ts';
import { buildAuditHooks } from './audit-hooks.ts';
import { buildCanUseTool } from './can-use-tool.ts';
import { DEFAULT_SETTING_SOURCES } from './preflight-config.ts';
import { sessionLogger } from './logger.ts';
import type { ResolvedModel, WorkerSpec } from './types.ts';

/** Variable d'isolation de compte, réglable par worker (H-53, vérifié en réel). */
export const CONFIG_DIR_ENV = 'CLAUDE_CONFIG_DIR';
/** Agent Teams (N2), expérimental, activé par équipe (H-14). */
export const AGENT_TEAMS_ENV = 'CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS';

export class OptionsCompositionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OptionsCompositionError';
  }
}

export interface ComposedWorkerOptions {
  readonly options: Options;
  /** `☠` à conserver en closure : seule voie d'arrêt immédiat (B.2.2). */
  readonly abortController: AbortController;
}

/**
 * `☠ CASSE` — `env` **remplace** l'environnement du sous-processus au lieu de
 * fusionner. Omettre `...process.env` fait perdre `PATH` : le worker ne trouve
 * plus git, node ni les credentials (panne #19).
 */
export function buildWorkerEnv(spec: WorkerSpec): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { ...process.env, ...spec.extraEnv };
  if (spec.configDir !== undefined) env[CONFIG_DIR_ENV] = spec.configDir;
  if (spec.agentTeams === true) env[AGENT_TEAMS_ENV] = '1';
  // ☠ Panne #15 (G.1.4, acceptation d) — vérifié ICI, au point de composition réel,
  // pas seulement documenté : `CLAUDE_CODE_RETRY_WATCHDOG=1` sans budget actif est une
  // consommation de quota non bornée. `extraEnv` est la seule voie qui pourrait le poser.
  assertRetryWatchdogCoherent(env, spec.maxBudgetUsd);
  return env;
}

function buildStderrSink(spec: WorkerSpec): (data: string) => void {
  const log = sessionLogger(spec.sessionId);
  return (data: string): void => {
    log.warn({ stderr: data }, 'stderr worker');
    try {
      spec.onStderr?.(data);
    } catch (error) {
      log.error({ err: error }, 'onStderr a levé — capture stderr dégradée');
    }
  };
}

/** Mode d'identité de session transmis au SDK — `sessionId` (neuf) ou `resume` (relance, M-13/B.3.3). */
export type ModeIdentiteSession = 'nouvelle' | 'reprise';

/**
 * Compose les options structurelles. Le modèle reçu est déjà résolu (H-43).
 *
 * `mode: 'reprise'` sert la relance (B.3.3, `RelanceurMission`) : le SDK est
 * exclusif entre `sessionId` et `resume` (sdk.d.ts, `Options.sessionId` —
 * « Cannot be used with continue or resume unless forkSession »). La relance
 * v1 ne fork jamais (`DecisionRelance.forkSession === false`), donc les deux
 * champs ne coexistent jamais ici.
 */
export function composeWorkerOptions(
  spec: WorkerSpec,
  model: ResolvedModel,
  mode: ModeIdentiteSession = 'nouvelle',
): ComposedWorkerOptions {
  const abortController = new AbortController();
  const identiteSession: Pick<Options, 'sessionId' | 'resume'> =
    mode === 'reprise' ? { resume: spec.sessionId } : { sessionId: spec.sessionId };
  const options: Options = {
    ...identiteSession,
    cwd: spec.cwd,
    permissionMode: 'auto',
    disallowedTools: [...spec.deniedToolPatterns],
    maxBudgetUsd: spec.maxBudgetUsd,
    model: model.resolved,
    systemPrompt: { type: 'preset', preset: 'claude_code', append: spec.mandate },
    settingSources: [...DEFAULT_SETTING_SOURCES],
    // `☠` L'autocompaction est POSÉE, jamais supposée. Elle dépendait jusqu'ici du
    // défaut du CLI et des settings du poste : un `autoCompactEnabled: false` posé
    // un jour dans un settings.json aurait laissé un lead saturer son contexte en
    // silence, sans que rien dans ce dépôt ne le dise. Vérifié le 2026-07-23 :
    // aucun settings du poste ni des comptes ne mentionnait la compaction.
    settings: { autoCompactEnabled: true },
    includePartialMessages: true,
    forwardSubagentText: true,
    agentProgressSummaries: true,
    abortController,
    env: buildWorkerEnv(spec),
    stderr: buildStderrSink(spec),
    // H-73.1 : fourni quel que soit permissionMode — pas un arbitre (le classifieur
    // tranche seul en 'auto', H-64), seul récepteur de redélivrance après coupure.
    canUseTool: buildCanUseTool(spec),
    // H-74 (5e occurrence) : le port d'audit était construit mais jamais branché
    // ici — angle mort total sur PreToolUse en permissionMode 'auto' (C.1.1, H-64).
    // Obligatoire dans le type (WorkerSpec.portAuditPermissions), enveloppé par
    // buildAuditHooks pour qu'une panne de l'audit ne bloque ni ne fasse échouer
    // le tour (propriété n°1 du harness).
    hooks: buildAuditHooks(spec),
    ...(spec.sessionStore !== undefined ? { sessionStore: spec.sessionStore } : {}),
    ...(spec.spawnProcess !== undefined ? { spawnClaudeCodeProcess: spec.spawnProcess } : {}),
  };
  assertOptionsInvariants(options);
  return { options, abortController };
}

/**
 * Garde-fou exécutable des trois pannes silencieuses de configuration.
 * Appelé à la composition, et rejouable en test.
 */
export function assertOptionsInvariants(options: Options): void {
  if (options.settingSources === undefined || options.settingSources.length === 0) {
    throw new OptionsCompositionError(
      'settingSources vide ou absent : la config du poste serait neutralisée en silence (H-44).',
    );
  }
  if (options.env !== undefined && process.env['PATH'] !== undefined && options.env['PATH'] === undefined) {
    throw new OptionsCompositionError(
      "env fourni sans ...process.env : PATH perdu, git/node/credentials introuvables (B.1.3).",
    );
  }
  const prompt = options.systemPrompt;
  if (typeof prompt !== 'object' || prompt === null || Array.isArray(prompt) || prompt.type !== 'preset') {
    throw new OptionsCompositionError(
      'systemPrompt doit être en forme preset claude_code : sans lui, le CLAUDE.md du poste ' +
        "n'est pas chargé même avec les bons settingSources (H-44).",
    );
  }
  if (options.hooks === undefined) {
    throw new OptionsCompositionError(
      "hooks est absent : l'audit des permissions (C.5, M-22) ne serait jamais branché sur ce " +
        "worker — 5e occurrence mesurée de H-74. buildAuditHooks() doit toujours rendre un objet, " +
        'même vide sur panne du port ; un `undefined` ici est un défaut de composition, pas un état normal.',
    );
  }
}
