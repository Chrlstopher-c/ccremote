/**
 * Protège la panne #18 : config machine neutralisée en silence.
 * Le pré-vol doit *constater* la cascade de settings et la visibilité du
 * CLAUDE.md du poste, jamais la supposer.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findProjectClaudeMd, machineClaudeMdPath, runPreflight } from './preflight-config.ts';

let root = '';
let configDir = '';
let worktree = '';

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'ccremote-preflight-'));
  configDir = join(root, 'compte1');
  worktree = join(root, 'projet', 'worktree');
  await mkdir(configDir, { recursive: true });
  await mkdir(join(worktree, '.claude'), { recursive: true });
  await writeFile(join(configDir, 'settings.json'), JSON.stringify({ model: 'opus' }));
  await writeFile(join(configDir, 'CLAUDE.md'), '# faits de machine');
  await writeFile(join(worktree, '.claude', 'settings.json'), JSON.stringify({}));
  await writeFile(join(worktree, 'CLAUDE.md'), '# conventions projet');
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('runPreflight', () => {
  test('confirme que le CLAUDE.md du poste est chargé et rend le modèle effectif', async () => {
    const report = await runPreflight({ cwd: worktree, configDir });
    expect(report.ok).toBe(true);
    expect(report.failures).toEqual([]);
    expect(report.machineClaudeMdPath).toBe(join(configDir, 'CLAUDE.md'));
    expect(report.projectClaudeMdPaths).toContain(join(worktree, 'CLAUDE.md'));
    expect(report.loadedSources).toContain('user');
    expect(report.effectiveModel).toBe('opus');
  });

  test('☠ échoue si settingSources est vide — la cascade devient muette', async () => {
    const report = await runPreflight({ cwd: worktree, configDir, settingSources: [] });
    expect(report.ok).toBe(false);
    const codes = report.failures.map((failure) => failure.code);
    expect(codes).toContain('setting_sources_empty');
    expect(codes).toContain('settings_cascade_empty');
    expect(report.loadedSources).toEqual([]);
  });

  test("échoue si le tier 'project' est retiré (le CLAUDE.md projet ne chargerait pas)", async () => {
    const report = await runPreflight({ cwd: worktree, configDir, settingSources: ['user'] });
    expect(report.ok).toBe(false);
    expect(report.failures.map((failure) => failure.code)).toContain('project_source_missing');
  });

  test('échoue si le CLAUDE.md machine est absent du répertoire de compte', async () => {
    const vide = join(root, 'compte-sans-claude-md');
    await mkdir(vide, { recursive: true });
    await writeFile(join(vide, 'settings.json'), JSON.stringify({ model: 'sonnet' }));
    const report = await runPreflight({ cwd: worktree, configDir: vide });
    expect(report.ok).toBe(false);
    expect(report.failures.map((failure) => failure.code)).toContain('machine_claude_md_missing');
    expect(report.machineClaudeMdPath).toBeNull();
  });

  test("l'isolation par compte ne fuit pas dans l'environnement du processus (H-53)", async () => {
    const before = process.env['CLAUDE_CONFIG_DIR'];
    await runPreflight({ cwd: worktree, configDir });
    expect(process.env['CLAUDE_CONFIG_DIR']).toBe(before);
  });
});

describe('helpers', () => {
  test('machineClaudeMdPath suit le répertoire de compte demandé', () => {
    expect(machineClaudeMdPath('/opt/comptes/c2')).toBe(join('/opt/comptes/c2', 'CLAUDE.md'));
  });

  test('findProjectClaudeMd remonte les répertoires parents', async () => {
    const found = await findProjectClaudeMd(join(worktree, '.claude'));
    expect(found).toContain(join(worktree, 'CLAUDE.md'));
  });
});
