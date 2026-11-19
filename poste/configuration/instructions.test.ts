import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pino from 'pino';
import { ecrireInstructions, empreinte, lireInstructions } from './instructions.ts';

const journal = pino({ level: 'silent' });
let dossier = '';

beforeEach(() => {
  dossier = mkdtempSync(join(tmpdir(), 'instructions-'));
});
afterEach(() => rmSync(dossier, { recursive: true, force: true }));

describe('instructions (CLAUDE.md de la machine)', () => {
  test('absent : contenu vide, empreinte du vide', () => {
    expect(lireInstructions(dossier, journal)).toEqual({
      chemin: join(dossier, 'CLAUDE.md'),
      contenu: '',
      empreinte: empreinte(''),
    });
  });

  test('écriture avec la bonne empreinte, puis relecture', () => {
    const avant = lireInstructions(dossier, journal).empreinte;
    const r = ecrireInstructions(dossier, '# Règles\n', avant, journal);
    expect(r).toEqual({ ok: true, empreinte: empreinte('# Règles\n') });
    expect(readFileSync(join(dossier, 'CLAUDE.md'), 'utf8')).toBe('# Règles\n');
  });

  test('une modification entre-temps donne un conflit et n’écrit rien', () => {
    const vue = lireInstructions(dossier, journal).empreinte;
    writeFileSync(join(dossier, 'CLAUDE.md'), 'modifié ailleurs');
    expect(ecrireInstructions(dossier, 'mien', vue, journal)).toEqual({ ok: false, erreur: 'conflit' });
    expect(readFileSync(join(dossier, 'CLAUDE.md'), 'utf8')).toBe('modifié ailleurs');
  });

  test('aucun fichier temporaire ne reste après une écriture', () => {
    ecrireInstructions(dossier, 'x', empreinte(''), journal);
    expect(readdirSync(dossier)).toEqual(['CLAUDE.md']);
  });
});
