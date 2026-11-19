import { describe, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { empreinteCode, extraireCodePoste } from './installer.ts';

function codeDeTest(mtime: number): string {
  const racine = mkdtempSync(join(tmpdir(), 'code-empreinte-'));
  for (const d of ['poste', 'commun']) mkdirSync(join(racine, d));
  writeFileSync(join(racine, 'poste', 'bin.ts'), 'export {};\n');
  writeFileSync(join(racine, 'commun', 'x.ts'), 'export const x = 1;\n');
  writeFileSync(join(racine, 'package.json'), '{}');
  writeFileSync(join(racine, 'bun.lock'), '');
  for (const f of ['poste/bin.ts', 'commun/x.ts', 'package.json', 'bun.lock']) utimesSync(join(racine, f), mtime, mtime);
  return racine;
}

describe('empreinte du code du poste', () => {
  test('deux copies du même code ont la même empreinte, quelle que soit leur date', async () => {
    const a = await empreinteCode(codeDeTest(1_700_000_000));
    const b = await empreinteCode(codeDeTest(1_800_000_000));
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  test('un fichier de code modifié change l’empreinte', async () => {
    const racine = codeDeTest(1_700_000_000);
    const avant = await empreinteCode(racine);
    writeFileSync(join(racine, 'commun', 'x.ts'), 'export const x = 2;\n');
    expect(await empreinteCode(racine)).not.toBe(avant);
  });

  test('l’archive embarquée (LANTERNE_MOTEUR_CODE_POSTE) s’extrait et donne la même empreinte', async () => {
    const source = codeDeTest(1_700_000_000);
    const tgz = join(mkdtempSync(join(tmpdir(), 'tgz-')), 'poste-code.tgz');
    execFileSync('tar', ['-czf', tgz, '-C', source, 'poste', 'commun', 'package.json', 'bun.lock']);
    const dossier = mkdtempSync(join(tmpdir(), 'extrait-'));
    const racine = await extraireCodePoste(tgz, dossier);
    expect(await empreinteCode(racine)).toBe(await empreinteCode(source));
  });
});
