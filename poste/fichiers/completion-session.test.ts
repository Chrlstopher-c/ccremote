import { afterAll, describe, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pino from 'pino';
import { competencesSession, etatsGit, fichiersProjet } from './completion-session.ts';

const journal = pino({ level: 'silent' });
const temporaires: string[] = [];
const nouveau = (prefixe: string): string => {
  const dossier = mkdtempSync(join(tmpdir(), prefixe));
  temporaires.push(dossier);
  return dossier;
};
afterAll(() => {
  for (const dossier of temporaires) rmSync(dossier, { recursive: true, force: true });
});

function ecrire(racine: string, relatif: string, texte: string): void {
  const absolu = join(racine, relatif);
  mkdirSync(join(absolu, '..'), { recursive: true });
  writeFileSync(absolu, texte);
}

function git(racine: string, ...args: string[]): void {
  execFileSync('git', ['-C', racine, '-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { stdio: 'ignore' });
}

describe('menu / : compétences et commandes de la session', () => {
  test('projet puis utilisateur, skills et commandes, triées ; le projet l’emporte à nom égal', () => {
    const projet = nouveau('a5-projet-');
    const utilisateur = nouveau('a5-user-');
    ecrire(projet, '.claude/skills/revue/SKILL.md', '---\nname: revue\ndescription: "Relit le diff"\n---\ncorps');
    ecrire(projet, '.claude/commands/deploie.md', '---\ndescription: Lance le déploiement\n---\n');
    ecrire(utilisateur, '.claude/skills/revue/SKILL.md', '---\nname: revue\ndescription: version perso\n---\n');
    ecrire(utilisateur, '.claude/skills/perso/SKILL.md', '---\nname: perso\ndescription: Mon outil\n---\n');
    ecrire(utilisateur, '.claude/commands/notes.md', 'Sans en-tête\n');
    return competencesSession(projet, utilisateur, journal).then((liste) => {
      expect(liste).toEqual([
        { nom: 'deploie', description: 'Lance le déploiement', projet: true },
        { nom: 'notes', description: '', projet: false },
        { nom: 'perso', description: 'Mon outil', projet: false },
        { nom: 'revue', description: 'Relit le diff', projet: true },
      ]);
    });
  });

  test('dossier sans compétence : liste vide, sans erreur', async () => {
    expect(await competencesSession(nouveau('a5-vide-'), nouveau('a5-vide-user-'), journal)).toEqual([]);
  });
});

describe('menu @ : fichiers du projet', () => {
  test('dans un dépôt : même liste que hors dépôt, le .gitignore n’est pas lu (comme le menu local)', async () => {
    const racine = nouveau('a5-depot-');
    git(racine, 'init', '-q');
    ecrire(racine, '.gitignore', 'ignore.log\ndist/\n');
    ecrire(racine, 'notes.md', 'texte\n');
    ecrire(racine, 'src/a.ts', 'export {};\n');
    ecrire(racine, 'ignore.log', 'bruit\n');
    ecrire(racine, 'dist/x.js', '//\n');
    ecrire(racine, '.claude/skills/s/SKILL.md', 'x\n');
    const fichiers = await fichiersProjet(racine, journal);
    expect(fichiers).toEqual(['.gitignore', 'ignore.log', 'notes.md', 'src/a.ts']);
  });

  test('hors dépôt : parcours sans dépendances ni dossiers cachés', async () => {
    const racine = nouveau('a5-nu-');
    ecrire(racine, 'README.md', '#\n');
    ecrire(racine, 'lib/b.py', '\n');
    ecrire(racine, 'node_modules/c.js', '\n');
    ecrire(racine, '.cache/d.txt', '\n');
    expect(await fichiersProjet(racine, journal)).toEqual(['README.md', 'lib/b.py']);
  });
});

describe('couleurs git de l’arbre', () => {
  test('ajouté, modifié, supprimé ; un dossier sans dépôt n’a pas de couleur', async () => {
    const racine = nouveau('a5-git-');
    git(racine, 'init', '-q');
    ecrire(racine, 'garde.md', 'a\n');
    ecrire(racine, 'retire.md', 'b\n');
    git(racine, 'add', '-A');
    git(racine, 'commit', '-q', '-m', 'premier');
    ecrire(racine, 'garde.md', 'modifie\n');
    rmSync(join(racine, 'retire.md'));
    ecrire(racine, 'nouveau/neuf.md', 'c\n');
    const etats = await etatsGit(racine, journal);
    expect(Object.fromEntries(etats)).toEqual({
      'garde.md': 'modifie',
      'nouveau/neuf.md': 'ajoute',
      'retire.md': 'supprime',
    });
    expect((await etatsGit(nouveau('a5-sans-git-'), journal)).size).toBe(0);
  });
});
