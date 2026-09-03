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
import type { ConfigProjet, IdEquipe, RevendicationEnVeilleRestauree, RevendicationWorktree } from './types.ts';

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
    // connu (active, en veille, ou déjà libérée) — une équipe avec un epoch
    // rejoué ou stagnant ne doit pas pouvoir se réapproprier le worktree en
    // silence. Égalité traitée comme l'inférieur : jamais une reprise légitime.
    // INCHANGÉ par les teams persistantes : le réveil d'une team PORTE un epoch
    // strictement supérieur (`prochainEpoch`, niveau projet), il franchit donc
    // cette garde comme n'importe quelle reprise légitime.
    if (existante !== undefined && params.epoch <= existante.epoch) {
      throw new EpochNonCroissantError(params.idEquipe, params.epoch, existante.epoch);
    }
    // ☠ RÉUTILISATION AU RÉVEIL (axe B) : une revendication `en_veille` est un
    // worktree CONSERVÉ, sans worker vivant dessus — réactivée sans aucun
    // `git worktree add`. C'est ce qui évite la collision `WorktreeDejaRevendiquee`
    // au réveil, SANS toucher au fencing : l'invariant « deux workers jamais sur
    // le même worktree » reste porté par la branche `revendiquee` ci-dessous,
    // seule à lever, car elle seule signale un worker RÉELLEMENT vivant.
    if (existante !== undefined && existante.etat === 'en_veille') {
      return this.#reactiverEnVeille(existante, params.epoch);
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

  /**
   * Restaure une revendication `en_veille` au démarrage du superviseur (axe B,
   * restauration PC). `☠` La Map est vide après un redémarrage : sans ce
   * réamorçage, `allouer()` ne verrait aucune revendication et retenterait un
   * `git worktree add` sur un répertoire qui existe déjà (le worktree persistant
   * survit sur disque). Reconstruite `en_veille` avec un epoch `0` : tout dispatch
   * réel porte un epoch strictement supérieur (`prochainEpoch`, niveau projet,
   * ≥ 1), il franchit donc le fencing et RÉUTILISE le worktree via `#reactiverEnVeille`.
   *
   * `☠` N'écrase JAMAIS une revendication déjà présente (worker vivant restauré
   * par une autre voie, ou double appel) : la restauration réamorce un état perdu,
   * elle ne supplante pas un état vivant. `brancheParent` est inconnue à la
   * restauration (la table `team` ne la porte pas) — `null`, sans conséquence sur
   * le réveil, qui ne la lit pas ; le démantèlement d'une team dormante passe par
   * le port `LiberateurWorktreeTeam` (teamId + worktree), pas par cette branche.
   */
  restaurerRevendicationEnVeille(rev: RevendicationEnVeilleRestauree): void {
    if (this.#revendications.has(rev.idEquipe)) return;
    const revendication: RevendicationWorktree = {
      idEquipe: rev.idEquipe,
      projetId: rev.projetId,
      cheminDepot: rev.cheminDepot,
      worktreePath: rev.worktreePath,
      brancheDediee: rev.brancheDediee,
      brancheParent: null,
      epoch: 0,
      isolationGarantie: rev.brancheDediee !== null,
      etat: 'en_veille',
      revendiqueeA: Date.now(),
      libereeA: null,
    };
    this.#revendications.set(rev.idEquipe, revendication);
    equipeLogger(rev.idEquipe).info(
      { worktreePath: rev.worktreePath },
      'revendication en veille restaurée depuis la table team (axe B, restauration PC)',
    );
  }

  /** Réactive une revendication en veille au réveil (axe B) — aucun git worktree add. */
  #reactiverEnVeille(existante: RevendicationWorktree, epoch: number): RevendicationWorktree {
    const reactivee: RevendicationWorktree = {
      ...existante,
      epoch,
      etat: 'revendiquee',
      revendiqueeA: Date.now(),
      libereeA: null,
    };
    this.#revendications.set(existante.idEquipe, reactivee);
    equipeLogger(existante.idEquipe).info(
      { worktreePath: reactivee.worktreePath, epoch },
      'worktree persistant réactivé au réveil de la team (aucun git worktree add)',
    );
    return reactivee;
  }

  /**
   * Fin d'activation d'une team VIVANTE (axe B) : le worktree est CONSERVÉ pour
   * le prochain réveil au lieu d'être libéré. `revendiquee` → `en_veille`, aucun
   * `git worktree remove`. Distinct de `liberer()`, réservé au démantèlement.
   *
   * `☠` Ne matche qu'une revendication `revendiquee` : mettre en veille une
   * revendication déjà libérée ou en veille n'a aucun sens et signalerait une
   * incohérence de cycle de vie — on lève plutôt que d'acquitter en silence.
   */
  mettreEnVeille(idEquipe: IdEquipe): RevendicationWorktree {
    const existante = this.#revendications.get(idEquipe);
    if (existante === undefined || existante.etat !== 'revendiquee') {
      throw new AucuneRevendicationActiveError(idEquipe);
    }
    const enVeille: RevendicationWorktree = { ...existante, etat: 'en_veille' };
    this.#revendications.set(idEquipe, enVeille);
    return enVeille;
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

  /**
   * F.2.3 — ne supprime **jamais** un worktree portant du travail non commité.
   *
   * `☠` Accepte `revendiquee` (fin de vie classique) ET `en_veille`
   * (démantèlement d'une team dormante, axe B) : dans les deux cas le worktree
   * existe sur disque et doit être supprimé s'il est propre. Seules `liberee` /
   * `terminee_non_liberee` (déjà traitées) et l'absence sont refusées.
   */
  async liberer(idEquipe: IdEquipe): Promise<RevendicationWorktree> {
    const existante = this.#revendications.get(idEquipe);
    if (existante === undefined || (existante.etat !== 'revendiquee' && existante.etat !== 'en_veille')) {
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
