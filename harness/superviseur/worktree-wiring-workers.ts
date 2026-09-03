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
 * Clé de revendication du worktree. `☠` `teamId` d'abord (axe B, worktree
 * persistant), `missionId` en repli : une mission hors team garde son worktree
 * keyé par mission, exactement comme avant. La clé décide du chemin
 * (`racineWorktrees/<clé>`) et de la branche (`equipe/<clé>`) — c'est ce qui rend
 * le worktree d'une team stable d'une activation à l'autre.
 */
function cleRevendication(demande: DemandeDemarrage): string {
  return demande.teamId ?? demande.missionId;
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
    domainesEquipe: [],
    isolationGarantie: estGit,
    fichierSource: '(dérivé au dispatch — aucun fichier de config F.1.2)',
  };

  try {
    return await deps.gestionnaireWorktrees.allouer({
      projet,
      idEquipe: cleRevendication(demande),
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
 * lieu. No-op si aucun gestionnaire n'est configuré, ou si cette clé n'a jamais
 * revendiqué de worktree (relance restaurée d'avant ce câblage, notamment) — les
 * deux cas sont attendus, pas des pannes. Best-effort : un échec ici ne doit
 * jamais empêcher `arreter()` de rendre la main.
 *
 * `☠` `cleWorktree` est la CLÉ de revendication (teamId pour une team persistante,
 * missionId sinon) — la même que celle passée à `allouer()`. Une team dormante
 * dont on démantèle le worktree est en `en_veille` : `liberer()` l'accepte.
 */
export async function libererWorktreeSiConfigure(
  deps: DependancesWorktreeWiring,
  cleWorktree: string,
  log: pino.Logger,
): Promise<void> {
  if (deps.gestionnaireWorktrees === undefined) return;
  try {
    const revendication = await deps.gestionnaireWorktrees.liberer(cleWorktree);
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
      log.debug({ cleWorktree }, 'aucune revendication de worktree pour cette clé — rien à libérer');
      return;
    }
    log.error({ err: erreur, cleWorktree }, 'libération du worktree échouée');
  }
}

/**
 * Fin d'activation d'une team VIVANTE (axe B) : le worktree est CONSERVÉ pour le
 * prochain réveil (`revendiquee` → `en_veille`), jamais supprimé. Distinct de
 * `libererWorktreeSiConfigure`, réservé au démantèlement. No-op si aucun
 * gestionnaire, ou si la clé n'a pas de revendication active — mêmes cas attendus
 * qu'à la libération. Best-effort : un échec ne bloque jamais l'appelant.
 */
export async function conserverWorktreeEnVeilleSiConfigure(
  deps: DependancesWorktreeWiring,
  cleWorktree: string,
  log: pino.Logger,
): Promise<void> {
  if (deps.gestionnaireWorktrees === undefined) return;
  try {
    const revendication = deps.gestionnaireWorktrees.mettreEnVeille(cleWorktree);
    log.info({ worktreePath: revendication.worktreePath }, 'worktree conservé en veille (team vivante, axe B)');
  } catch (erreur) {
    if (erreur instanceof AucuneRevendicationActiveError) {
      log.debug({ cleWorktree }, 'aucune revendication active pour cette clé — rien à mettre en veille');
      return;
    }
    log.error({ err: erreur, cleWorktree }, 'mise en veille du worktree échouée');
  }
}
