// Responsabilité : tests du dépôt de travail d'une session (racine, branche, propriétaire/dépôt, repli sur le
// transcript) et de la recherche du transcript. Dépôts git jetables dans un dossier temporaire ; aucun dépôt réel.
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Logger } from 'pino';
import { depotDeTravail, dossierDeTravail, oublierDepots } from './depot.ts';
import { oublierEtats, lireEtat } from './lecture.ts';
import { transcriptDeSession } from './transcript-session.ts';
import { assistant, horodatage, outil, prLink } from './fabrique-transcript.ts';

const JOURNAL = { warn: () => undefined, debug: () => undefined, error: () => undefined } as unknown as Logger;
let racine = '';

beforeAll(() => {
  racine = mkdtempSync(join(tmpdir(), 'parite-depot-'));
});
afterAll(() => {
  rmSync(racine, { recursive: true, force: true });
});
beforeEach(() => {
  oublierDepots();
  oublierEtats();
});

async function git(cwd: string, ...args: string[]): Promise<string> {
  const p = Bun.spawn(['git', ...args], { cwd, stdout: 'pipe', stderr: 'pipe' });
  const sortie = await new Response(p.stdout).text();
  await p.exited;
  return sortie.trim();
}

async function depotGit(nom: string, url: string | null, branche = 'main'): Promise<string> {
  const dossier = join(racine, nom);
  mkdirSync(dossier, { recursive: true });
  await git(dossier, 'init', '-q', '-b', branche);
  await git(
    dossier,
    '-c',
    'user.email=t@example.com',
    '-c',
    'user.name=t',
    'commit',
    '-q',
    '--allow-empty',
    '-m',
    'init',
  );
  if (url !== null) await git(dossier, 'remote', 'add', 'origin', url);
  writeFileSync(join(dossier, 'README.md'), '# test\n');
  return dossier;
}

function transcriptAvec(lignes: string[], nom: string): string {
  const chemin = join(racine, `${nom}.jsonl`);
  writeFileSync(chemin, lignes.join('\n') + '\n');
  return chemin;
}

describe('dépôt de travail', () => {
  test('cwd dans un dépôt GitHub (ssh) : source dossier, branche, propriétaire/dépôt, PR du dépôt', async () => {
    const dossier = await depotGit('ssh', 'git@github.com:acme/outil.git', 'feature/x');
    const chemin = transcriptAvec(
      [prLink(horodatage(1), 3, 'autre/projet'), prLink(horodatage(2), 9, 'acme/outil')],
      'ssh',
    );
    const etat = lireEtat(chemin, JOURNAL);
    if (!etat) throw new Error('état attendu');
    const depot = await depotDeTravail(dossier, etat, JOURNAL);
    expect(depot).toMatchObject({
      racine: realpathSync(dossier),
      branche: 'feature/x',
      depot: 'acme/outil',
      source: 'dossier',
      pr: { numero: 9, url: 'https://github.com/acme/outil/pull/9', depot: 'acme/outil' },
    });
  });

  test('origin en https, sans PR connue : depot lu, pr null', async () => {
    const dossier = await depotGit('https', 'https://github.com/acme/autre.git');
    const chemin = transcriptAvec([], 'https');
    const etat = lireEtat(chemin, JOURNAL);
    if (!etat) throw new Error('état attendu');
    const depot = await depotDeTravail(dossier, etat, JOURNAL);
    expect(depot?.depot).toBe('acme/autre');
    expect(depot?.pr).toBeNull();
  });

  test("cwd hors dépôt : racine déduite des derniers appels d'outil (source transcript)", async () => {
    const dossier = await depotGit('repli', 'git@github.com:acme/repli.git');
    const hors = join(racine, 'hors-depot');
    mkdirSync(hors, { recursive: true });
    const chemin = transcriptAvec(
      [assistant(horodatage(1), [outil('e1', 'Edit', { file_path: join(dossier, 'README.md') })])],
      'repli',
    );
    const etat = lireEtat(chemin, JOURNAL);
    if (!etat) throw new Error('état attendu');
    const depot = await depotDeTravail(hors, etat, JOURNAL);
    expect(depot).toMatchObject({ racine: realpathSync(dossier), source: 'transcript', depot: 'acme/repli' });
  });

  test('dossierDeTravail : cwd si dépôt, sinon racine du transcript, sinon cwd', async () => {
    const dossier = await depotGit('dossier', null);
    const hors = join(racine, 'sans-depot');
    mkdirSync(hors, { recursive: true });
    const chemin = transcriptAvec(
      [assistant(horodatage(1), [outil('e2', 'Write', { file_path: join(dossier, 'a.md') })])],
      'dossier',
    );
    expect(await dossierDeTravail(dossier, null, JOURNAL)).toBe(dossier);
    expect(await dossierDeTravail(hors, chemin, JOURNAL)).toBe(realpathSync(dossier));
    expect(await dossierDeTravail(hors, null, JOURNAL)).toBe(hors);
  });
});

describe("transcript d'une session", () => {
  test('session connue : son dossier de configuration ; inconnue : recherche dans les configurations', () => {
    const id = '11111111-2222-3333-4444-555555555555';
    const config = join(racine, 'config-a');
    const connu = join(config, 'projects', '-mnt-projects-x', `${id}.jsonl`);
    mkdirSync(join(config, 'projects', '-mnt-projects-x'), { recursive: true });
    writeFileSync(connu, '');
    const dansAutre = join(config, 'projects', 'autre-dossier', `${id}.jsonl`);
    mkdirSync(join(config, 'projects', 'autre-dossier'), { recursive: true });
    writeFileSync(dansAutre, '');
    expect(transcriptDeSession({ cwd: '/mnt/projects/x', claudeSessionId: id }, config, [], JOURNAL)).toBe(connu);
    expect(transcriptDeSession({ cwd: '/inconnu', claudeSessionId: id }, undefined, [config], JOURNAL)).toBe(dansAutre);
  });

  test('identifiant de conversation invalide ou absent : aucune recherche', () => {
    expect(transcriptDeSession({ cwd: '/x', claudeSessionId: '../etc' }, undefined, [null], JOURNAL)).toBeNull();
    expect(transcriptDeSession({ cwd: '/x', claudeSessionId: null }, undefined, [null], JOURNAL)).toBeNull();
  });
});
