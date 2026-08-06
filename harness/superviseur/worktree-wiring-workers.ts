/**
 * Responsabilité : câblage du cycle de vie worktree ↔ mission au démarrage et à
 * la fin de vie d'un worker (F.2, mandat câblage-worktree, E2). Extrait
 * MÉCANIQUEMENT de `superviseur-workers.ts` (même motif que
 * `fencing-arbitrage-workers.ts`/`budgets-workers.ts`) pour respecter la limite
 * de 500 lignes — aucun changement de comportement. `SuperviseurWorkers` reste
 * seul à décider QUAND appeler ceci (`demarrer()`/`arreter()`).
 *
 * `☠` Aucun fichier de config F.1.2 n'est chargé ici : `demande.spec.cwd` est la
 * seule donnée transportée depuis le Pi, donc le `ConfigProjet` passé à
 * `allouer()` est reconstruit à la volée depuis un relevé git réel — jamais
 * simulé. `estGit` exige à la fois un dépôt ET une branche courante lisible :
 * un dépôt en HEAD détachée n'a pas de `brancheDefaut` exploitable par
 * `git worktree add`, donc il retombe en mode dégradé plutôt que de lever.
 */

import type pino from 'pino';
import { releverEtatGit } from './etat-git.ts';
import { AucuneRevendicationActiveError } from '../projets/index.ts';
import type { ConfigProjet, GestionnaireCycleVieWorktree, RevendicationWorktree } from '../projets/index.ts';
import type { DemandeDemarrage } from './types.ts';

export interface DependancesWorktreeWiring {
  /** `undefined` ⇒ aucune allocation git n'est tentée (mode dégradé pour tout le
   * monde, comportement historique) — défaut pour les tests qui n'en injectent pas. */
  readonly gestionnaireWorktrees: GestionnaireCycleVieWorktree | undefined;
  readonly racineWorktrees: string;
}

/**
 * Alloue un worktree git dédié pour cette mission. `null` si aucun gestionnaire
 * n'est configuré — le cwd fourni par le Pi reste alors la seule source, exactement
 * le comportement d'avant ce câblage.
 */
export async function allouerWorktreeSiConfigure(
  deps: DependancesWorktreeWiring,
  demande: DemandeDemarrage,
  log: pino.Logger,
): Promise<RevendicationWorktree | null> {
  if (deps.gestionnaireWorktrees === undefined) return null;

  const cheminDepot = demande.spec.cwd;
  const constat = await releverEtatGit(cheminDepot);
  const estGit = constat.depot && constat.branche !== null;
  const projet: ConfigProjet = {
    id: cheminDepot,
    cheminDepot,
    estGit,
    brancheDefaut: estGit ? constat.branche : null,
    // `☠` Champs sans consommateur ici (`allouer()` ne lit que `estGit`,
    // `brancheDefaut`, `cheminDepot`, `id`) — posés à des valeurs neutres pour
    // satisfaire `ConfigProjet`, jamais lus par ce chemin.
    budgetMaxUsd: 0,
    modeleDefaut: '',
    deniedToolPatternsSupplementaires: [],
    agentTeamsActif: false,
    mandatType: '',
    isolationGarantie: estGit,
    fichierSource: '(dérivé au dispatch — aucun fichier de config F.1.2)',
  };

  try {
    return await deps.gestionnaireWorktrees.allouer({
      projet,
      idEquipe: demande.missionId,
      epoch: demande.epoch,
      racineWorktrees: deps.racineWorktrees,
    });
  } catch (erreur) {
    log.error({ err: erreur, cheminDepot }, 'allocation du worktree échouée — aucun spawn (F.2)');
    throw erreur;
  }
}

/**
 * Fin de mission : libère la revendication de worktree si une allocation a eu
 * lieu. No-op si aucun gestionnaire n'est configuré, ou si cette mission n'a
 * jamais revendiqué de worktree (relance restaurée d'avant ce câblage,
 * notamment) — les deux cas sont attendus, pas des pannes. Best-effort : un
 * échec ici ne doit jamais empêcher `arreter()` de rendre la main.
 */
export async function libererWorktreeSiConfigure(
  deps: DependancesWorktreeWiring,
  missionId: string,
  log: pino.Logger,
): Promise<void> {
  if (deps.gestionnaireWorktrees === undefined) return;
  try {
    const revendication = await deps.gestionnaireWorktrees.liberer(missionId);
    if (revendication.etat === 'terminee_non_liberee') {
      log.warn(
        { worktreePath: revendication.worktreePath },
        'travail non commité détecté — worktree CONSERVÉ (F.2.3, panne #9)',
      );
    } else {
      log.info({ worktreePath: revendication.worktreePath }, 'worktree libéré (F.2.2)');
    }
  } catch (erreur) {
    if (erreur instanceof AucuneRevendicationActiveError) {
      log.debug({ missionId }, 'aucune revendication de worktree pour cette mission — rien à libérer');
      return;
    }
    log.error({ err: erreur, missionId }, 'libération du worktree échouée');
  }
}
