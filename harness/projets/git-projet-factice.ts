/**
 * Doublures en mémoire de `InterrogateurGit` / `GestionnaireWorktreeGit`, réservées
 * aux tests de ce domaine (`validation-config.test.ts`, `cycle-vie-worktree.test.ts`).
 * Aucun process réel : uniquement des tables en mémoire — conforme à la règle de
 * la mission (☠ pas de commande git mutante sur un vrai dépôt dans cette session).
 */

import type { GestionnaireWorktreeGit, InterrogateurGit } from './git-projet.ts';

export interface OptionsInterrogateurFactice {
  readonly depots?: ReadonlySet<string>;
  readonly branches?: ReadonlyMap<string, ReadonlySet<string>>;
  readonly sale?: boolean;
  /** `true` ⇒ simule un échec de la vérification elle-même (F.2.3, pire cas sûr). */
  readonly leveErreur?: boolean;
}

export class InterrogateurGitFactice implements InterrogateurGit {
  constructor(private readonly options: OptionsInterrogateurFactice = {}) {}

  async estDepotGit(cheminDepot: string): Promise<boolean> {
    return this.options.depots?.has(cheminDepot) ?? false;
  }

  async existeBranche(cheminDepot: string, branche: string): Promise<boolean> {
    return this.options.branches?.get(cheminDepot)?.has(branche) ?? false;
  }

  async aTravailNonCommite(): Promise<boolean> {
    if (this.options.leveErreur === true) throw new Error('git status a échoué (factice)');
    return this.options.sale ?? false;
  }
}

export class GestionnaireWorktreeGitFactice implements GestionnaireWorktreeGit {
  readonly appelsCreer: { cheminDepot: string; worktreePath: string; brancheDediee: string; depuisBranche: string }[] = [];
  readonly appelsSupprimer: { cheminDepot: string; worktreePath: string }[] = [];

  constructor(private readonly echoueACreer = false) {}

  async creer(cheminDepot: string, worktreePath: string, brancheDediee: string, depuisBranche: string): Promise<void> {
    if (this.echoueACreer) throw new Error('git worktree add a échoué (factice)');
    this.appelsCreer.push({ cheminDepot, worktreePath, brancheDediee, depuisBranche });
  }

  async supprimer(cheminDepot: string, worktreePath: string): Promise<void> {
    this.appelsSupprimer.push({ cheminDepot, worktreePath });
  }
}
