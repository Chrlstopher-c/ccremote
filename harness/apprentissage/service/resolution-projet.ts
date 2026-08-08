/**
 * Responsabilité : résoudre le chemin du DÉPÔT git canonique depuis un `cwd` de worker — qui,
 * à la clôture d'une mission, est le plus souvent un worktree dédié
 * (`<racine>/.worktrees/<uuid>`, F.2), jamais le dépôt lui-même. `ResumeMission.projet` et
 * `Lecon.projet` doivent porter le dépôt (SPEC C-1, C-7 : « chemin du dépôt, pas le
 * worktree ») — sans quoi une leçon apprise dans un worktree, unique à chaque mission, ne
 * serait jamais retrouvée par la mission suivante et l'injection (E7) serait structurellement
 * vide.
 *
 * `☠` `git rev-parse --git-common-dir` depuis un worktree rend `<dépôt>/.git` — c'est la même
 * primitive git que `git worktree add` utilise pour lier un worktree à son dépôt d'origine.
 * Vérifié en réel depuis CE worktree pendant l'implémentation :
 *   `git rev-parse --path-format=absolute --git-common-dir` ⇒ `/mnt/projects/ccremote/.git`.
 * Jamais de suppression du sous-dossier `.git` à la légère : `dirname()` suffit et reste
 * correct pour un dépôt "normal" (non-worktree) aussi, où `--git-common-dir` rend `<dépôt>/.git`
 * directement.
 *
 * Conception inspirée de Hermes Agent (Nous Research) — MIT. Transposition indépendante en TypeScript.
 */

import { execFile } from 'node:child_process';
import { dirname } from 'node:path';
import { promisify } from 'node:util';
import { journal } from '../logger.ts';

const execFileAsync = promisify(execFile);

/** Au-delà, on retombe sur `cwd` tel quel plutôt que d'attendre indéfiniment. */
const DELAI_MS = 5_000;

/**
 * Résout le dépôt git canonique depuis `cwd`. Ne lève JAMAIS — un `cwd` non-git, un `git`
 * absent, ou un timeout retombent sur `cwd` lui-même (comportement identique à
 * `worktree-wiring-workers.ts` pour un projet non-git : « cheminDepot lui-même »).
 */
export async function resoudreCheminDepot(cwd: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], {
      cwd,
      timeout: DELAI_MS,
    });
    const gitCommonDir = stdout.trim();
    if (gitCommonDir.length === 0) return cwd;
    return dirname(gitCommonDir);
  } catch (erreur) {
    journal.debug({ err: erreur, cwd }, 'résolution du dépôt git impossible — repli sur cwd (non-git ou timeout)');
    return cwd;
  }
}
