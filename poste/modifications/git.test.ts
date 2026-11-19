import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pino from 'pino';
import { DepotGit, resoudreDansDossier } from './git.ts';

const journal = pino({ enabled: false });
let racine = '';

beforeAll(() => {
  racine = mkdtempSync(join(tmpdir(), 'quart-git-'));
});

afterAll(() => {
  rmSync(racine, { recursive: true, force: true });
});

function git(dossier: string, ...args: string[]): string {
  const processus = Bun.spawnSync(
    ['git', '-C', dossier, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...args],
    { stdout: 'pipe', stderr: 'pipe' },
  );
  if (processus.exitCode !== 0) throw new Error(new TextDecoder().decode(processus.stderr));
  return new TextDecoder().decode(processus.stdout);
}

// Dépôt sur `main` avec un commit : a.txt (3 lignes) et b.txt.
function depot(): string {
  const dossier = mkdtempSync(join(racine, 'depot-'));
  git(dossier, 'init', '-q', '-b', 'main');
  writeFileSync(join(dossier, 'a.txt'), '1\n2\n3\n');
  writeFileSync(join(dossier, 'b.txt'), 'b\n');
  git(dossier, 'add', '-A');
  git(dossier, 'commit', '-q', '-m', 'initial');
  return dossier;
}

describe('modifications d’un dépôt', () => {
  test('non commitées : modifié, supprimé, et non suivi compté comme ajout', async () => {
    const dossier = depot();
    writeFileSync(join(dossier, 'a.txt'), '1\n2\n3\n4\n');
    rmSync(join(dossier, 'b.txt'));
    writeFileSync(join(dossier, 'c.txt'), 'x\ny\n');
    const m = await new DepotGit(dossier, journal).modifications('non_commitees');
    expect(m.branche).toBe('main');
    expect(m.racine).toBe(realpathSync(dossier));
    expect(m.fichiers).toEqual([
      { chemin: 'a.txt', etat: 'modifie', ajouts: 1, suppressions: 0, binaire: false },
      { chemin: 'b.txt', etat: 'supprime', ajouts: 0, suppressions: 1, binaire: false },
      { chemin: 'c.txt', etat: 'ajoute', ajouts: 2, suppressions: 0, binaire: false },
    ]);
  });

  test('diff d’un fichier suivi et d’un fichier non suivi', async () => {
    const dossier = depot();
    writeFileSync(join(dossier, 'a.txt'), '1\nDEUX\n3\n');
    writeFileSync(join(dossier, 'n.txt'), 'neuf\n');
    const depotGit = new DepotGit(dossier, journal);
    const suivi = await depotGit.diff('a.txt', 'non_commitees');
    expect(suivi.etat).toBe('modifie');
    expect(suivi.hunks[0]?.lignes.map((l) => [l.genre, l.texte])).toEqual([
      ['contexte', '1'],
      ['retrait', '2'],
      ['ajout', 'DEUX'],
      ['contexte', '3'],
    ]);
    const nouveau = await depotGit.diff('n.txt', 'non_commitees');
    expect(nouveau).toMatchObject({ etat: 'ajoute', binaire: false });
    expect(nouveau.hunks[0]?.lignes).toEqual([{ genre: 'ajout', ancien: null, nouveau: 1, texte: 'neuf' }]);
  });

  test('annuler : retour au commit pour un fichier suivi, suppression pour un non suivi', async () => {
    const dossier = depot();
    writeFileSync(join(dossier, 'a.txt'), 'casse\n');
    rmSync(join(dossier, 'b.txt'));
    writeFileSync(join(dossier, 'c.txt'), 'x\n');
    const depotGit = new DepotGit(dossier, journal);
    await depotGit.annuler('a.txt');
    await depotGit.annuler('b.txt');
    await depotGit.annuler('c.txt');
    expect(readFileSync(join(dossier, 'a.txt'), 'utf8')).toBe('1\n2\n3\n');
    expect(readFileSync(join(dossier, 'b.txt'), 'utf8')).toBe('b\n');
    expect(existsSync(join(dossier, 'c.txt'))).toBe(false);
    expect((await depotGit.modifications('non_commitees')).fichiers).toEqual([]);
  });

  test('commiter : tout est ajouté, commité, et rend l’empreinte courte', async () => {
    const dossier = depot();
    writeFileSync(join(dossier, 'a.txt'), '1\n2\n3\n4\n');
    writeFileSync(join(dossier, 'c.txt'), 'x\n');
    const empreinte = await new DepotGit(dossier, journal).commiter('  Ajoute la quatrième ligne  ');
    expect(empreinte).toMatch(/^[0-9a-f]{4,}$/);
    expect(git(dossier, 'log', '-1', '--format=%s')).toBe('Ajoute la quatrième ligne\n');
    expect((await new DepotGit(dossier, journal).modifications('non_commitees')).fichiers).toEqual([]);
  });

  test('commiter refuse un message vide', async () => {
    const dossier = depot();
    await expect(new DepotGit(dossier, journal).commiter('   ')).rejects.toThrow('le message de commit est vide');
  });

  test('portée branche : compare à main (ancêtre commun), y compris les commits de la branche', async () => {
    const dossier = depot();
    git(dossier, 'checkout', '-q', '-b', 'feat');
    writeFileSync(join(dossier, 'a.txt'), '1\n2\n3\n4\n');
    git(dossier, 'commit', '-q', '-am', 'feat');
    const m = await new DepotGit(dossier, journal).modifications('branche');
    expect(m.branche).toBe('feat');
    expect(m.fichiers).toEqual([{ chemin: 'a.txt', etat: 'modifie', ajouts: 1, suppressions: 0, binaire: false }]);
  });

  test('hors dépôt git : erreur lisible', async () => {
    const hors = mkdtempSync(join(racine, 'hors-'));
    await expect(new DepotGit(hors, journal).modifications('non_commitees')).rejects.toThrow('hors dépôt git');
  });

  test('un chemin qui sort du dossier est refusé avant toute commande', async () => {
    const dossier = depot();
    const depotGit = new DepotGit(dossier, journal);
    await expect(depotGit.annuler('../secret')).rejects.toThrow('chemin refusé');
    await expect(depotGit.diff('/etc/passwd', 'non_commitees')).rejects.toThrow('chemin refusé');
  });
});

describe('confinement des chemins', () => {
  test('accepte un chemin du dossier, refuse l’absolu, le parent et un lien qui sort', () => {
    const dossier = mkdtempSync(join(racine, 'confine-'));
    const exterieur = mkdtempSync(join(racine, 'dehors-'));
    writeFileSync(join(dossier, 'ok.txt'), 'x');
    expect(resoudreDansDossier(dossier, 'ok.txt')).toBe(join(dossier, 'ok.txt'));
    expect(() => resoudreDansDossier(dossier, '../ailleurs')).toThrow('chemin refusé');
    expect(() => resoudreDansDossier(dossier, '/etc/passwd')).toThrow('chemin refusé');
    mkdirSync(join(exterieur, 'sous'));
    symlinkSync(exterieur, join(dossier, 'lien'));
    expect(() => resoudreDansDossier(dossier, 'lien/sous')).toThrow('chemin refusé');
  });
});
