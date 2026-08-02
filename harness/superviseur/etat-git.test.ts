/**
 * `☠` Banc sur de VRAIS dépôts git en `mktemp` — pas de doublure. Ce module
 * n'existe que pour dire la vérité sur un disque : le tester contre une
 * simulation de git ne prouverait rien de ce qui a coûté (une équipe présentée
 * comme terminée avec son travail non commité).
 */

import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { releverEtatGit, resumerConstatGit } from './etat-git.ts';

const execFileAsync = promisify(execFile);
const aNettoyer: string[] = [];

async function depot(options: { commit?: boolean; sale?: boolean } = {}): Promise<string> {
  const racine = await mkdtemp(join(tmpdir(), 'ccremote-git-'));
  aNettoyer.push(racine);
  await execFileAsync('git', ['-C', racine, 'init', '-q', '-b', 'principale']);
  await execFileAsync('git', ['-C', racine, 'config', 'user.email', 'banc@ccremote.test']);
  await execFileAsync('git', ['-C', racine, 'config', 'user.name', 'Banc']);
  if (options.commit === true) {
    await writeFile(join(racine, 'livre.txt'), 'livré\n');
    await execFileAsync('git', ['-C', racine, 'add', '.']);
    await execFileAsync('git', ['-C', racine, 'commit', '-q', '-m', 'travail livré']);
  }
  if (options.sale === true) {
    await writeFile(join(racine, 'en-cours.ts'), 'export const x = 1;\n');
    await writeFile(join(racine, 'aussi-en-cours.ts'), 'export const y = 2;\n');
  }
  return racine;
}

afterAll(async () => {
  for (const chemin of aNettoyer) await rm(chemin, { recursive: true, force: true });
});

describe('releverEtatGit — le fait qui distingue « a livré » de « a parlé »', () => {
  test('☠ travail NON COMMITÉ : compté, nommé, et dit comme tel', async () => {
    const constat = await releverEtatGit(await depot({ commit: true, sale: true }));
    expect(constat.depot).toBe(true);
    expect(constat.fichiersModifies).toBe(2);
    expect(constat.apercu).toContain('en-cours.ts');
    expect(resumerConstatGit(constat)).toContain('NON COMMITÉ');
  });

  test('dépôt propre : aucun fichier modifié, dernier commit rapporté', async () => {
    const constat = await releverEtatGit(await depot({ commit: true }));
    expect(constat.fichiersModifies).toBe(0);
    expect(constat.branche).toBe('principale');
    expect(constat.dernierCommit).toContain('travail livré');
    expect(resumerConstatGit(constat)).toContain('aucun fichier non commité');
  });

  test('☠ dépôt SANS AUCUN COMMIT : le travail est intégralement non commité', async () => {
    const constat = await releverEtatGit(await depot({ sale: true }));
    expect(constat.dernierCommit).toBeNull();
    expect(constat.fichiersModifies).toBe(2);
    expect(resumerConstatGit(constat)).toContain('aucun commit');
  });

  test('☠ chemin qui n’est pas un dépôt ⇒ constat indisponible, jamais « propre »', async () => {
    const nu = await mkdtemp(join(tmpdir(), 'ccremote-nu-'));
    aNettoyer.push(nu);
    await mkdir(join(nu, 'sous'), { recursive: true });
    const constat = await releverEtatGit(join(nu, 'sous'));
    expect(constat.depot).toBe(false);
    expect(constat.note).toBeDefined();
    expect(resumerConstatGit(constat)).toContain('indisponible');
  });

  test('chemin inexistant ⇒ constat porteur de sa note, aucune exception', async () => {
    const constat = await releverEtatGit('/chemin/qui/nexiste/pas/du/tout');
    expect(constat.depot).toBe(false);
    expect(constat.fichiersModifies).toBe(0);
  });
});
