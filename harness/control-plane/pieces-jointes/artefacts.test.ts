/**
 * Tests du domaine « artefacts » : l'extension décide seule du type, rien
 * n'est écrit sur un refus, et deux artefacts du même nom ne s'écrasent pas.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ecrireArtefact, ErreurArtefact, MAX_OCTETS_ARTEFACT, typesArtefactAcceptes } from './artefacts.ts';

let racine: string;

beforeEach(() => {
  racine = mkdtempSync(join(tmpdir(), 'artefacts-test-'));
});

afterEach(() => {
  rmSync(racine, { recursive: true, force: true });
});

describe('ecrireArtefact', () => {
  test('écrit une page HTML sous la conversation, avec le bon type', async () => {
    const ecrit = await ecrireArtefact(racine, 'conv-1', 'demo.html', '<html>ok</html>', 1_700_000_000_000);
    expect(ecrit.type).toBe('text/html');
    expect(ecrit.fichier).toBe('1700000000000-demo.html');
    expect(existsSync(ecrit.chemin)).toBe(true);
    expect(await readFile(ecrit.chemin, 'utf8')).toBe('<html>ok</html>');
  });

  test('écrit un script shell, Python ou Lua avec le type dérivé de l’extension', async () => {
    const sh = await ecrireArtefact(racine, 'conv-1', 'run.sh', '#!/bin/sh\necho ok', 1_000);
    const py = await ecrireArtefact(racine, 'conv-1', 'run.py', 'print("ok")', 2_000);
    const lua = await ecrireArtefact(racine, 'conv-1', 'run.lua', 'print("ok")', 3_000);
    expect(sh.type).toBe('text/x-sh');
    expect(py.type).toBe('text/x-python');
    expect(lua.type).toBe('text/x-lua');
  });

  test('☠ refuse une extension hors périmètre, et n’écrit rien', async () => {
    await expect(ecrireArtefact(racine, 'conv-1', 'script.exe', 'MZ...')).rejects.toThrow(ErreurArtefact);
    expect(existsSync(join(racine, 'conv-1'))).toBe(false);
  });

  test('☠ nomme les extensions acceptées dans le refus', async () => {
    try {
      await ecrireArtefact(racine, 'conv-1', 'notes.txt', 'x');
      throw new Error('devait lever');
    } catch (erreur) {
      expect((erreur as Error).message).toContain('.html');
      expect((erreur as Error).message).toContain('.sh');
    }
  });

  test('☠ refuse un contenu vide', async () => {
    await expect(ecrireArtefact(racine, 'conv-1', 'vide.py', '')).rejects.toThrow(/vide/);
  });

  test('☠ refuse au-delà du plafond', async () => {
    const trop = 'x'.repeat(MAX_OCTETS_ARTEFACT + 1);
    await expect(ecrireArtefact(racine, 'conv-1', 'gros.py', trop)).rejects.toThrow(/plafond/);
  });

  test('deux artefacts du même nom, à des instants différents, ne s’écrasent pas', async () => {
    await ecrireArtefact(racine, 'conv-1', 'script.py', 'un', 1_000);
    await ecrireArtefact(racine, 'conv-1', 'script.py', 'deux', 2_000);
    expect(readdirSync(join(racine, 'conv-1'))).toHaveLength(2);
  });

  test('la traversée de chemin dans le nom est neutralisée comme pour une pièce jointe', async () => {
    const ecrit = await ecrireArtefact(racine, 'conv-1', '../../etc/evil.sh', 'echo x', 1_000);
    expect(ecrit.fichier).not.toContain('..');
    expect(ecrit.fichier).not.toContain('/etc/');
  });
});

describe('typesArtefactAcceptes', () => {
  test('couvre exactement le périmètre du mandat', () => {
    expect(typesArtefactAcceptes()).toEqual(['html', 'sh', 'py', 'lua']);
  });
});
