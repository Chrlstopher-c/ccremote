import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pino from 'pino';
import { creerStyle, listerStyles, slugDe, stylesDisque } from './styles.ts';

const journal = pino({ level: 'silent' });
let racine = '';

beforeEach(() => {
  racine = mkdtempSync(join(tmpdir(), 'styles-'));
});
afterEach(() => rmSync(racine, { recursive: true, force: true }));

describe('listerStyles', () => {
  test('intégrés d’abord, puis les fichiers des dossiers donnés (nom du frontmatter ou du fichier)', () => {
    const config = join(racine, 'config');
    mkdirSync(join(config, 'output-styles'), { recursive: true });
    writeFileSync(join(config, 'output-styles', 'sobre.md'), '---\nname: Sobre\n---\nx');
    writeFileSync(join(config, 'output-styles', 'brut.md'), 'sans entête');
    expect(listerStyles([config, join(racine, 'absent')], journal)).toEqual([
      'default',
      'Explanatory',
      'Learning',
      'brut',
      'Sobre',
    ]);
  });

  test('stylesDisque : actuel = style de session ou défaut, projet inclus', () => {
    const config = join(racine, 'config');
    const projet = join(racine, 'projet');
    mkdirSync(join(projet, '.claude', 'output-styles'), { recursive: true });
    writeFileSync(join(projet, '.claude', 'output-styles', 'local.md'), '---\nname: Local\n---\n');
    expect(stylesDisque(config, projet, null, journal)).toEqual({
      actuel: 'default',
      disponibles: ['default', 'Explanatory', 'Learning', 'Local'],
    });
    expect(stylesDisque(config, projet, 'Learning', journal).actuel).toBe('Learning');
  });
});

describe('creerStyle', () => {
  test('écrit output-styles/<slug>.md avec le frontmatter et les instructions', () => {
    const config = join(racine, 'config');
    const r = creerStyle(config, { nom: 'Ton Sobre', description: 'Bref', instructions: 'Réponds court.' }, journal);
    expect(r).toEqual({ ok: true, nom: 'Ton Sobre' });
    const texte = readFileSync(join(config, 'output-styles', 'ton-sobre.md'), 'utf8');
    expect(texte).toContain('name: "Ton Sobre"');
    expect(texte).toContain('Réponds court.');
  });

  test('refuse un fichier existant (409 côté relais) sans rien écraser', () => {
    const config = join(racine, 'config');
    creerStyle(config, { nom: 'Doublon', description: 'a', instructions: 'un' }, journal);
    const r = creerStyle(config, { nom: 'doublon', description: 'b', instructions: 'deux' }, journal);
    expect(r).toEqual({ ok: false, erreur: 'un style porte déjà ce nom' });
    expect(readFileSync(join(config, 'output-styles', 'doublon.md'), 'utf8')).toContain('un');
  });

  test('refuse les noms intégrés et les noms sans lettre ni chiffre', () => {
    const config = join(racine, 'config');
    expect(creerStyle(config, { nom: 'learning', description: '', instructions: 'x' }, journal).ok).toBe(false);
    expect(creerStyle(config, { nom: '!!!', description: '', instructions: 'x' }, journal)).toEqual({
      ok: false,
      erreur: 'nom de style invalide',
    });
    expect(existsSync(join(config, 'output-styles'))).toBe(false);
  });

  test('slugDe retire les accents et les séparateurs', () => {
    expect(slugDe('  Éclair  du  Soir ! ')).toBe('eclair-du-soir');
  });
});
