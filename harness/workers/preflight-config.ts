/**
 * Responsabilité : pré-vol de configuration avant tout spawn (B.1.2 étape 1, H-44).
 *
 * Vérifie que la cascade de settings du poste est réellement chargée et que le
 * CLAUDE.md machine est visible. `☠ CASSE` — sans ce contrôle, une config absente
 * produit un agent qui ignore les conventions du poste **sans que rien ne le
 * signale** (panne #18 de la grille de revue).
 */

import { access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, join, parse } from 'node:path';
import { homedir } from 'node:os';
import { resolveSettings } from '@anthropic-ai/claude-agent-sdk';
import type { SettingSource } from '@anthropic-ai/claude-agent-sdk';
import { workerLogger } from './logger.ts';
import type { PreflightFailure, PreflightReport } from './types.ts';

/** Les trois tiers du CLI. Le harness ne passe **jamais** `[]` (H-44). */
export const DEFAULT_SETTING_SOURCES: readonly SettingSource[] = ['user', 'project', 'local'];

/** Même liste, élargie en chaînes : `ResolvedSettingSource` inclut aussi les tiers de politique. */
const FILESYSTEM_SOURCE_NAMES: readonly string[] = DEFAULT_SETTING_SOURCES;

/** Profondeur maximale de remontée pour trouver un CLAUDE.md de projet. */
const MAX_WALK_UP = 32;

export interface PreflightInput {
  readonly cwd: string;
  /** Répertoire de config du compte visé (H-53). Défaut : celui du processus. */
  readonly configDir?: string;
  readonly settingSources?: readonly SettingSource[];
}

/**
 * `resolveSettings()` lit `CLAUDE_CONFIG_DIR` dans l'environnement du processus
 * au moment de l'appel (vérifié en exécution). Pour auditer la config d'un autre
 * compte il faut donc muter l'environnement, ce qui est incompatible avec des
 * pré-vols concurrents : les appels sont sérialisés.
 */
let configDirLock: Promise<unknown> = Promise.resolve();

function withConfigDir<T>(configDir: string | undefined, fn: () => Promise<T>): Promise<T> {
  const run = configDirLock.then(async (): Promise<T> => {
    if (configDir === undefined) return fn();
    const previous = process.env['CLAUDE_CONFIG_DIR'];
    process.env['CLAUDE_CONFIG_DIR'] = configDir;
    try {
      return await fn();
    } finally {
      if (previous === undefined) delete process.env['CLAUDE_CONFIG_DIR'];
      else process.env['CLAUDE_CONFIG_DIR'] = previous;
    }
  });
  configDirLock = run.catch(() => undefined);
  return run;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Ce qu'un `CLAUDE_CONFIG_DIR` d'équipe doit contenir pour qu'un lead soit
 * réellement outillé.
 *
 * `☠` Isoler un compte isole AUSSI toute sa configuration : ni CLAUDE.md, ni
 * skills, ni règles, ni settings. Le harness compense par des liens posés à la
 * main — et « à la main » est le défaut. Relevé le 01/08 : `reference/` manquait
 * sur les DEUX comptes (alors que CLAUDE.md et les règles y renvoient
 * nommément), et `settings.json` — donc les hooks — sur `compte-b` seulement.
 * Comme la rotation multi-comptes est automatique, une équipe n'avait pas les
 * mêmes capacités selon le compte tiré, et rien ne le disait nulle part.
 *
 * `plugins/` en est volontairement absent : c'est de l'ÉTAT par compte, pas un
 * réglage partageable. Voir `config-equipe/installer-config-compte.sh`.
 */
const ELEMENTS_CONFIG_COMPTE: readonly string[] = ['CLAUDE.md', 'rules', 'reference', 'skills', 'settings.json'];

/**
 * Liste ce qui manque au répertoire de config d'un compte. Tableau vide si
 * aucun `configDir` n'est imposé : on est alors sur la config du poste, hors
 * sujet ici.
 */
export async function elementsConfigManquants(configDir?: string): Promise<readonly string[]> {
  if (configDir === undefined) return [];
  const absents: string[] = [];
  for (const nom of ELEMENTS_CONFIG_COMPTE) {
    if (!(await exists(join(configDir, nom)))) absents.push(nom);
  }
  return absents;
}

/** Chemin du CLAUDE.md machine pour le répertoire de config visé. */
export function machineClaudeMdPath(configDir?: string): string {
  const base = configDir ?? process.env['CLAUDE_CONFIG_DIR'] ?? join(homedir(), '.claude');
  return join(base, 'CLAUDE.md');
}

/** Remonte depuis `cwd` et collecte les CLAUDE.md de projet visibles. */
export async function findProjectClaudeMd(cwd: string): Promise<string[]> {
  const found: string[] = [];
  const root = parse(cwd).root;
  let current = cwd;
  for (let depth = 0; depth < MAX_WALK_UP; depth += 1) {
    for (const candidate of [join(current, 'CLAUDE.md'), join(current, '.claude', 'CLAUDE.md')]) {
      if (await exists(candidate)) found.push(candidate);
    }
    if (current === root) break;
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return found;
}

interface CascadeResult {
  readonly loadedSources: SettingSource[];
  readonly effectiveModel: string | null;
  readonly failure: PreflightFailure | null;
}

async function readCascade(input: PreflightInput, sources: readonly SettingSource[]): Promise<CascadeResult> {
  try {
    const resolved = await withConfigDir(input.configDir, () =>
      resolveSettings({ cwd: input.cwd, settingSources: [...sources] }),
    );
    const loadedSources = resolved.sources
      .map((entry) => entry.source)
      .filter((source): source is SettingSource => FILESYSTEM_SOURCE_NAMES.includes(source));
    return { loadedSources, effectiveModel: resolved.effective.model ?? null, failure: null };
  } catch (error) {
    workerLogger.error({ err: error, cwd: input.cwd }, 'resolveSettings a échoué');
    return {
      loadedSources: [],
      effectiveModel: null,
      failure: { code: 'resolve_settings_failed', detail: String(error) },
    };
  }
}

function checkSources(sources: readonly SettingSource[]): PreflightFailure[] {
  const failures: PreflightFailure[] = [];
  if (sources.length === 0) {
    failures.push({
      code: 'setting_sources_empty',
      detail: 'settingSources: [] neutralise silencieusement la config du poste (H-44).',
    });
  }
  if (!sources.includes('project')) {
    failures.push({
      code: 'project_source_missing',
      detail: "le tier 'project' est requis pour charger le CLAUDE.md de projet (H-44).",
    });
  }
  return failures;
}

/**
 * Exécute le pré-vol. `ok === false` ⇒ **ne pas spawner**, remonter au Pi.
 */
export async function runPreflight(input: PreflightInput): Promise<PreflightReport> {
  const sources = input.settingSources ?? DEFAULT_SETTING_SOURCES;
  const failures: PreflightFailure[] = checkSources(sources);
  const cascade = await readCascade(input, sources);
  if (cascade.failure !== null) failures.push(cascade.failure);
  else if (cascade.loadedSources.length === 0) {
    failures.push({
      code: 'settings_cascade_empty',
      detail: `aucun tier de settings chargé depuis le disque pour ${input.cwd}.`,
    });
  }

  const machinePath = machineClaudeMdPath(input.configDir);
  const machineVisible = await exists(machinePath);
  if (!machineVisible) {
    failures.push({ code: 'machine_claude_md_missing', detail: `${machinePath} introuvable ou illisible.` });
  }

  // `☠` Relevé APRÈS le calcul de `ok` : cet écart n'empêche pas de travailler,
  // il dégrade. Une équipe sans `reference/` ni skills produit un travail moins
  // bon, pas un travail faux — refuser de spawner pour ça immobiliserait le parc
  // pour un lien manquant. Ce qui était inacceptable, c'est que personne ne
  // puisse le CONSTATER : c'est ce qui a permis à l'écart entre les deux comptes
  // de vivre neuf jours.
  const manquants = await elementsConfigManquants(input.configDir);

  const report: PreflightReport = {
    ok: failures.length === 0,
    cwd: input.cwd,
    loadedSources: cascade.loadedSources,
    machineClaudeMdPath: machineVisible ? machinePath : null,
    projectClaudeMdPaths: await findProjectClaudeMd(input.cwd),
    effectiveModel: cascade.effectiveModel,
    failures,
  };
  if (manquants.length > 0) {
    workerLogger.warn(
      { configDir: input.configDir, manquants, code: 'config_compte_incomplete' },
      'config du compte incomplète — l’équipe démarre DÉGRADÉE (voir config-equipe/installer-config-compte.sh)',
    );
  }
  workerLogger.info({ preflight: report }, report.ok ? 'pré-vol config OK' : 'pré-vol config en échec');
  return report;
}
