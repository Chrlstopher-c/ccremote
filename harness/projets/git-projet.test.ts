/**
 * Constructeurs de commande purs de `git-projet.ts` — testés sans jamais lancer
 * de processus réel (l'implémentation qui shell-out n'est pas exercée ici,
 * conformément à la règle de session : pas de commande git mutante sur un vrai
 * dépôt).
 */

import { describe, expect, test } from 'bun:test';
import {
  construireCommandeCommitsEnAttente,
  construireCommandeCreerWorktree,
  construireCommandeEstDepotGit,
  construireCommandeExisteBranche,
  construireCommandeStatutPorcelain,
  construireCommandeSupprimerWorktree,
} from './git-projet.ts';

describe('git-projet — constructeurs de commande purs', () => {
  test('estDepotGit', () => {
    expect(construireCommandeEstDepotGit('/x')).toEqual({ cmd: 'git', args: ['-C', '/x', 'rev-parse', '--is-inside-work-tree'] });
  });

  test('existeBranche', () => {
    expect(construireCommandeExisteBranche('/x', 'main')).toEqual({
      cmd: 'git',
      args: ['-C', '/x', 'show-ref', '--verify', '--quiet', 'refs/heads/main'],
    });
  });

  test('statut porcelain', () => {
    expect(construireCommandeStatutPorcelain('/x')).toEqual({ cmd: 'git', args: ['-C', '/x', 'status', '--porcelain'] });
  });

  test('commits en attente', () => {
    expect(construireCommandeCommitsEnAttente('/x', 'main', 'equipe/a')).toEqual({
      cmd: 'git',
      args: ['-C', '/x', 'log', 'main..equipe/a', '--oneline'],
    });
  });

  test('créer worktree', () => {
    expect(construireCommandeCreerWorktree('/depot', '/wt/a', 'equipe/a', 'main')).toEqual({
      cmd: 'git',
      args: ['-C', '/depot', 'worktree', 'add', '-b', 'equipe/a', '/wt/a', 'main'],
    });
  });

  test('supprimer worktree — jamais --force (F.2.3, filet indépendant)', () => {
    const { args } = construireCommandeSupprimerWorktree('/depot', '/wt/a');
    expect(args).not.toContain('--force');
    expect(args).toEqual(['-C', '/depot', 'worktree', 'remove', '/wt/a']);
  });
});
