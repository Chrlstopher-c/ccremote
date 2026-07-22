/**
 * Responsabilité : cycle de vie de la revendication worktree ↔ équipe (F.2).
 *
 * Garanties mécaniques, pas conventionnelles — les deux pannes dont cette
 * mission répond dans `15-grille-revue.md` :
 *
 * `☠ CASSE #10` — « association worktree enregistrée après le spawn ». Ici,
 * `allouer()` est le **seul** point de sortie qui produit un `worktreePath`
 * utilisable, et l'enregistrement dans `#revendications` a lieu **dans la même
 * fonction**, avant le `return`. Il n'existe aucun chemin de code qui rende un
 * chemin sans que la revendication existe déjà — pas de fenêtre à fermer, parce
 * qu'il n'y a jamais eu de fenêtre ouverte.
 *
 * `☠ CASSE #9` — « worktree supprimé avec travail non commité ». `liberer()` a
 * un seul site d'appel à `gestionnaire.supprimer()`, textuellement à l'intérieur
 * de la branche `!sale`. Impossible d'atteindre la suppression sans être passé
 * par le contrôle git — y compris quand ce contrôle lui-même échoue (F.2.3 :
 * on suppose alors le pire cas sûr, voir `git-projet.ts`).
 *
 * `☠ CASSE #2` (D.2.3, mission M-11) — cette mission PORTE l'epoch sans jamais
 * l'arbitrer (`ParametresAllocation.epoch` traversait `allouer()` sans être
 * comparé à rien). L'arbitrage RÉEL du fencing — qui doit terminer un worker
 * périmé — vit dans `superviseur/fencing-epoch.ts` (branche B, seul endroit qui
 * détient un vrai process à tuer). Ce module ajoute la validation COMPLÉMENTAIRE
 * qui lui revient en propre, à ce niveau logique : `allouer()` refuse toute
 * revendication dont l'epoch ne progresse PAS strictement par rapport au dernier
 * epoch connu pour cette équipe — égalité comprise (piège déjà payé : un
 * fencing qui ne rejette que le strictement inférieur laisse une collision
 * passer). Elle ne supersède jamais une revendication encore `revendiquee` : ça
 * resterait `WorktreeDejaRevendiqueeError`, sans changement — cette mission ne
 * décide PAS qui doit mourir, elle refuse seulement qu'un epoch stagnant ou
 * régressé s'approprie l'allocation logique du worktree.
 */

import { join } from 'node:path';
import { equipeLogger } from './logger.ts';
import type { GestionnaireWorktreeGit, InterrogateurGit } from './git-projet.ts';
import type { ConfigProjet, IdEquipe, RevendicationWorktree } from './types.ts';

export class WorktreeDejaRevendiqueeError extends Error {
  constructor(readonly idEquipe: IdEquipe) {
    super(`l'équipe "${idEquipe}" a déjà un worktree vivant revendiqué (F.2.1, point 1).`);
    this.name = 'WorktreeDejaRevendiqueeError';
  }
}

export class AucuneRevendicationActiveError extends Error {
  constructor(readonly idEquipe: IdEquipe) {
    super(`aucune revendication active pour l'équipe "${idEquipe}" — rien à libérer.`);
    this.name = 'AucuneRevendicationActiveError';
  }
}

/**
 * D.2.3, fencing — un epoch qui ne progresse PAS strictement (égal OU inférieur
 * au dernier connu pour cette équipe) ne peut jamais revendiquer le worktree,
 * qu'une revendication précédente soit encore active ou déjà libérée. L'égalité
 * est un cas de première classe ici aussi (☠ piège déjà payé) : elle ne tombe
 * jamais dans une simple comparaison « inférieur ».
 */
export class EpochNonCroissantError extends Error {
  constructor(
    readonly idEquipe: IdEquipe,
    readonly epochRecu: number,
    readonly epochConnu: number,
  ) {
    super(
      `l'équipe "${idEquipe}" a déjà un epoch connu de ${epochConnu} ; ` +
        `epoch reçu ${epochRecu} (${epochRecu === epochConnu ? 'égal' : 'inférieur'}) — ` +
        'ne peut pas revendiquer le worktree (D.2.3, fencing).',
    );
    this.name = 'EpochNonCroissantError';
  }
}

export interface DependancesCycleVieWorktree {
  readonly interrogateur: InterrogateurGit;
  readonly gestionnaire: GestionnaireWorktreeGit;
}

export interface ParametresAllocation {
  readonly projet: ConfigProjet;
  readonly idEquipe: IdEquipe;
  /** Fourni par l'appelant (D.2.3) — cette mission n'arbitre pas le fencing, elle le porte. */
  readonly epoch: number;
  /** Racine sous laquelle créer les worktrees dédiés (hors du dépôt principal). */
  readonly racineWorktrees: string;
}

function brancheDedieeDe(idEquipe: IdEquipe): string {
  return `equipe/${idEquipe}`;
}

/**
 * Registre des associations projet ↔ worktree ↔ équipe (F.1.1) et de leur cycle
 * de vie (F.2.1 à F.2.3). Ne connaît rien du superviseur de workers ni du
 * fencing par epoch (D.2.3, M-11) — hors périmètre de cette mission (☠ scope guard).
 */
export class GestionnaireCycleVieWorktree {
  readonly #revendications = new Map<IdEquipe, RevendicationWorktree>();

  constructor(private readonly deps: DependancesCycleVieWorktree) {}

  /** F.2.1 — enregistrement **avant** tout usage du chemin rendu. */
  async allouer(params: ParametresAllocation): Promise<RevendicationWorktree> {
    const existante = this.#revendications.get(params.idEquipe);

    // ☠ Fencing (D.2.3) : vérifié AVANT le contrôle d'état, et pour TOUT état
    // connu (active ou déjà libérée) — une équipe déjà libérée avec un epoch
    // rejoué ou stagnant ne doit pas pouvoir se réapproprier le worktree en
    // silence. Égalité traitée comme l'inférieur : jamais une reprise légitime.
    if (existante !== undefined && params.epoch <= existante.epoch) {
      throw new EpochNonCroissantError(params.idEquipe, params.epoch, existante.epoch);
    }
    if (existante !== undefined && existante.etat === 'revendiquee') {
      throw new WorktreeDejaRevendiqueeError(params.idEquipe);
    }

    const log = equipeLogger(params.idEquipe);
    const revendication = params.projet.estGit
      ? await this.#allouerWorktreeGit(params, log)
      : this.#allouerModeDegrade(params, log);

    // ☠ Ligne charnière de la garantie (c) : aucun `return` avant celle-ci.
    this.#revendications.set(params.idEquipe, revendication);
    return revendication;
  }

  async #allouerWorktreeGit(params: ParametresAllocation, log: ReturnType<typeof equipeLogger>): Promise<RevendicationWorktree> {
    const worktreePath = join(params.racineWorktrees, params.idEquipe);
    const brancheDediee = brancheDedieeDe(params.idEquipe);
    // `⚠` `brancheDefaut` est garantie non nulle par la validation F.1.2/F.4.2
    // pour tout projet `estGit === true` — voir `validation-config.ts`.
    const depuisBranche = params.projet.brancheDefaut as string;
    try {
      await this.deps.gestionnaire.creer(params.projet.cheminDepot, worktreePath, brancheDediee, depuisBranche);
    } catch (error) {
      log.error({ err: error, worktreePath }, 'création du worktree échouée — aucune revendication enregistrée');
      throw error;
    }
    return {
      idEquipe: params.idEquipe,
      projetId: params.projet.id,
      cheminDepot: params.projet.cheminDepot,
      worktreePath,
      brancheDediee,
      brancheParent: depuisBranche,
      epoch: params.epoch,
      isolationGarantie: true,
      etat: 'revendiquee',
      revendiqueeA: Date.now(),
      libereeA: null,
    };
  }

  /** F.1.3 — mode dégradé : pas de worktree, isolation non garantie, signalé tel quel. */
  #allouerModeDegrade(params: ParametresAllocation, log: ReturnType<typeof equipeLogger>): RevendicationWorktree {
    log.warn(
      { projetId: params.projet.id, cheminDepot: params.projet.cheminDepot },
      "projet non-git : mode dégradé, isolation NON garantie (F.1.3) — répertoire dédié partagé",
    );
    return {
      idEquipe: params.idEquipe,
      projetId: params.projet.id,
      cheminDepot: params.projet.cheminDepot,
      worktreePath: params.projet.cheminDepot,
      brancheDediee: null,
      brancheParent: null,
      epoch: params.epoch,
      isolationGarantie: false,
      etat: 'revendiquee',
      revendiqueeA: Date.now(),
      libereeA: null,
    };
  }

  /** F.2.3 — ne supprime **jamais** un worktree portant du travail non commité. */
  async liberer(idEquipe: IdEquipe): Promise<RevendicationWorktree> {
    const existante = this.#revendications.get(idEquipe);
    if (existante === undefined || existante.etat !== 'revendiquee') {
      throw new AucuneRevendicationActiveError(idEquipe);
    }

    if (!existante.isolationGarantie) {
      return this.#figerLiberation(existante);
    }

    const log = equipeLogger(idEquipe);
    // `brancheParent`/`brancheDediee` ne sont jamais nulles ici : `isolationGarantie`
    // implique `estGit`, qui implique une branche parente validée à l'allocation.
    const sale = await this.deps.interrogateur.aTravailNonCommite(
      existante.worktreePath,
      existante.brancheParent as string,
      existante.brancheDediee as string,
    );
    if (sale) {
      log.warn({ worktreePath: existante.worktreePath }, 'travail non commité détecté — worktree CONSERVÉ (☠ panne #9)');
      const nonLiberee: RevendicationWorktree = { ...existante, etat: 'terminee_non_liberee' };
      this.#revendications.set(idEquipe, nonLiberee);
      return nonLiberee;
    }

    // ☠ Unique site d'appel de `supprimer()` dans tout le module — voir en-tête.
    await this.deps.gestionnaire.supprimer(existante.cheminDepot, existante.worktreePath);
    return this.#figerLiberation(existante);
  }

  #figerLiberation(revendication: RevendicationWorktree): RevendicationWorktree {
    const liberee: RevendicationWorktree = { ...revendication, etat: 'liberee', libereeA: Date.now() };
    this.#revendications.set(revendication.idEquipe, liberee);
    return liberee;
  }

  revendicationsActives(): readonly RevendicationWorktree[] {
    return [...this.#revendications.values()].filter((r) => r.etat === 'revendiquee');
  }

  revendicationDe(idEquipe: IdEquipe): RevendicationWorktree | undefined {
    return this.#revendications.get(idEquipe);
  }
}
