/**
 * Responsabilité : interroger et manipuler l'état git d'un projet (F.1.3, F.2).
 *
 * Deux contrats injectables — mêmes principes que `SuperviseurWorkers` côté
 * `test-harness/contrats` : la logique d'orchestration (validation-config.ts,
 * cycle-vie-worktree.ts) ne dépend jamais de l'implémentation réelle, testée à
 * part via une doublure. `☠ CASSE #9` (worktree supprimé avec travail non
 * commité) est structurellement hors de portée d'un test unitaire déterministe
 * — même constat déjà posé dans `test-harness/README.md` — donc l'implémentation
 * réelle ci-dessous n'est PAS exercée contre un vrai dépôt dans cette mission :
 * seuls les constructeurs de commande purs le sont.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { projetsLogger } from './logger.ts';

const execFileAsync = promisify(execFile);

export interface InterrogateurGit {
  estDepotGit(cheminDepot: string): Promise<boolean>;
  existeBranche(cheminDepot: string, branche: string): Promise<boolean>;
  /**
   * `true` si le worktree porte des modifications non commitées, ou des commits
   * sur `brancheDediee` non encore intégrés dans `brancheParent` (F.2.3).
   * `⚠ HYP` — « commits en attente » est lu ici comme « non intégrés dans la
   * branche parente », faute de définition plus précise dans `09-arbre-F`. À
   * corriger si l'opérateur vise plutôt « non poussés vers un remote ».
   */
  aTravailNonCommite(worktreePath: string, brancheParent: string, brancheDediee: string): Promise<boolean>;
}

export interface GestionnaireWorktreeGit {
  creer(cheminDepot: string, worktreePath: string, brancheDediee: string, depuisBranche: string): Promise<void>;
  /**
   * `git worktree remove` (sans `--force`) refuse lui-même un worktree sale —
   * filet de sécurité indépendant de `aTravailNonCommite`, en profondeur.
   */
  supprimer(cheminDepot: string, worktreePath: string): Promise<void>;
}

/** Construit `git -C <chemin> rev-parse --is-inside-work-tree`. Pur, testable sans process. */
export function construireCommandeEstDepotGit(cheminDepot: string): { cmd: string; args: string[] } {
  return { cmd: 'git', args: ['-C', cheminDepot, 'rev-parse', '--is-inside-work-tree'] };
}

export function construireCommandeExisteBranche(
  cheminDepot: string,
  branche: string,
): { cmd: string; args: string[] } {
  return { cmd: 'git', args: ['-C', cheminDepot, 'show-ref', '--verify', '--quiet', `refs/heads/${branche}`] };
}

export function construireCommandeStatutPorcelain(worktreePath: string): { cmd: string; args: string[] } {
  return { cmd: 'git', args: ['-C', worktreePath, 'status', '--porcelain'] };
}

export function construireCommandeCommitsEnAttente(
  worktreePath: string,
  brancheParent: string,
  brancheDediee: string,
): { cmd: string; args: string[] } {
  return { cmd: 'git', args: ['-C', worktreePath, 'log', `${brancheParent}..${brancheDediee}`, '--oneline'] };
}

export function construireCommandeCreerWorktree(
  cheminDepot: string,
  worktreePath: string,
  brancheDediee: string,
  depuisBranche: string,
): { cmd: string; args: string[] } {
  return { cmd: 'git', args: ['-C', cheminDepot, 'worktree', 'add', '-b', brancheDediee, worktreePath, depuisBranche] };
}

export function construireCommandeSupprimerWorktree(
  cheminDepot: string,
  worktreePath: string,
): { cmd: string; args: string[] } {
  return { cmd: 'git', args: ['-C', cheminDepot, 'worktree', 'remove', worktreePath] };
}

async function executer(cmd: string, args: string[]): Promise<{ code: number; stdout: string }> {
  try {
    const { stdout } = await execFileAsync(cmd, args);
    return { code: 0, stdout };
  } catch (error) {
    // `execFile` rejette avec une `Error` enrichie d'un `code` numérique (exit
    // code du process) quand la commande s'exécute mais échoue — non typé par
    // `node:child_process`, d'où le cast local, borné à cette seule lecture.
    const brut = error as { code?: unknown };
    const code = typeof brut.code === 'number' ? brut.code : 1;
    return { code, stdout: '' };
  }
}

/** Implémentation réelle — non exercée contre un vrai dépôt dans cette mission (voir en-tête). */
export class InterrogateurGitReel implements InterrogateurGit {
  async estDepotGit(cheminDepot: string): Promise<boolean> {
    try {
      const { cmd, args } = construireCommandeEstDepotGit(cheminDepot);
      const { code, stdout } = await executer(cmd, args);
      return code === 0 && stdout.trim() === 'true';
    } catch (error) {
      projetsLogger.error({ err: error, cheminDepot }, 'estDepotGit a levé');
      return false;
    }
  }

  async existeBranche(cheminDepot: string, branche: string): Promise<boolean> {
    try {
      const { cmd, args } = construireCommandeExisteBranche(cheminDepot, branche);
      const { code } = await executer(cmd, args);
      return code === 0;
    } catch (error) {
      projetsLogger.error({ err: error, cheminDepot, branche }, 'existeBranche a levé');
      return false;
    }
  }

  /**
   * `☠ CASSE` (panne #9) — le pire cas sûr doit couvrir **le code de sortie**, pas
   * seulement une exception. `executer()` n'ayant jamais levé (il **avale** l'échec et
   * rend `stdout: ''`), s'en remettre au seul `catch` rendait un git en échec
   * indiscernable d'un worktree propre : `stdout` vide ⇒ « rien à sauver » ⇒
   * suppression. Bug réel constaté le 2026-07-22 par `acceptation/worktree-git-reel.ts`,
   * sur un worktree dont le lien `.git` avait disparu.
   *
   * Règle : toute vérification qui n'aboutit pas **franchement** vaut « sale ». Un faux
   * positif retarde une libération ; un faux négatif détruit du travail.
   */
  async aTravailNonCommite(worktreePath: string, brancheParent: string, brancheDediee: string): Promise<boolean> {
    try {
      const porcelain = construireCommandeStatutPorcelain(worktreePath);
      const statut = await executer(porcelain.cmd, porcelain.args);
      if (statut.code !== 0) {
        projetsLogger.error({ worktreePath, code: statut.code }, 'statut git en échec — worktree présumé SALE');
        return true;
      }
      if (statut.stdout.trim().length > 0) return true;

      const enAttente = construireCommandeCommitsEnAttente(worktreePath, brancheParent, brancheDediee);
      const commits = await executer(enAttente.cmd, enAttente.args);
      if (commits.code !== 0) {
        projetsLogger.error({ worktreePath, code: commits.code }, 'comparaison de branches en échec — worktree présumé SALE');
        return true;
      }
      return commits.stdout.trim().length > 0;
    } catch (error) {
      projetsLogger.error({ err: error, worktreePath }, 'aTravailNonCommite a levé');
      return true;
    }
  }
}

export class GestionnaireWorktreeGitReel implements GestionnaireWorktreeGit {
  async creer(cheminDepot: string, worktreePath: string, brancheDediee: string, depuisBranche: string): Promise<void> {
    const { cmd, args } = construireCommandeCreerWorktree(cheminDepot, worktreePath, brancheDediee, depuisBranche);
    try {
      await execFileAsync(cmd, args);
    } catch (error) {
      projetsLogger.error({ err: error, cheminDepot, worktreePath }, 'création du worktree échouée');
      throw error;
    }
  }

  async supprimer(cheminDepot: string, worktreePath: string): Promise<void> {
    const { cmd, args } = construireCommandeSupprimerWorktree(cheminDepot, worktreePath);
    try {
      await execFileAsync(cmd, args);
    } catch (error) {
      projetsLogger.error({ err: error, cheminDepot, worktreePath }, 'suppression du worktree échouée');
      throw error;
    }
  }
}
