import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pino from 'pino';
import type { PluginBrut } from './plugins.ts';
import { listerCompetences, lireCompetence } from './competences.ts';

const journal = pino({ level: 'silent' });
let racine = '';

function skill(dossier: string, nom: string, texte: string): string {
  mkdirSync(join(dossier, nom), { recursive: true });
  writeFileSync(join(dossier, nom, 'SKILL.md'), texte);
  return join(dossier, nom, 'SKILL.md');
}

beforeEach(() => {
  racine = mkdtempSync(join(tmpdir(), 'competences-'));
});
afterEach(() => rmSync(racine, { recursive: true, force: true }));

function plugin(id: string, dossier: string, enabled: boolean): PluginBrut {
  return { id, version: '1.0.0', scope: 'user', enabled, installPath: dossier };
}

describe('listerCompetences', () => {
  test('utilisateur et plug-ins activés, triés par nom ; plug-in désactivé ignoré', () => {
    const config = join(racine, 'config');
    const pluginA = join(racine, 'plugin-a');
    const pluginB = join(racine, 'plugin-b');
    skill(join(config, 'skills'), 'zeta', '---\nname: zeta\ndescription: Dernier\n---\n');
    skill(join(pluginA, 'skills'), 'alpha', '---\nname: alpha\ndescription: Premier\n---\n');
    skill(join(pluginB, 'skills'), 'cache', '---\nname: cache\n---\n');
    const liste = listerCompetences(config, [plugin('a@m', pluginA, true), plugin('b@m', pluginB, false)], journal);
    expect(liste.map((c) => [c.nom, c.source, c.plugin ?? null])).toEqual([
      ['alpha', 'plugin', 'a@m'],
      ['zeta', 'utilisateur', null],
    ]);
    expect(liste[0]?.description).toBe('Premier');
  });

  test('sans frontmatter name, le nom du dossier sert', () => {
    const config = join(racine, 'config');
    skill(join(config, 'skills'), 'sans-nom', 'corps seul');
    expect(listerCompetences(config, [], journal)[0]?.nom).toBe('sans-nom');
  });
});

describe('lireCompetence', () => {
  test('lit un SKILL.md listé', () => {
    const config = join(racine, 'config');
    const chemin = skill(join(config, 'skills'), 'x', '---\nname: x\n---\nCorps');
    expect(lireCompetence(config, [], chemin, journal)).toEqual({ ok: true, contenu: '---\nname: x\n---\nCorps' });
  });

  test('refuse tout autre chemin, même lisible (interdit)', () => {
    const config = join(racine, 'config');
    const hors = join(racine, 'secret.md');
    writeFileSync(hors, 'pas une compétence');
    expect(lireCompetence(config, [], hors, journal)).toEqual({ ok: false, erreur: 'interdit' });
    expect(lireCompetence(config, [], join(config, 'skills', '..', '..', 'secret.md'), journal).ok).toBe(false);
  });
});
