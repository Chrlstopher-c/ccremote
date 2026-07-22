/**
 * Responsabilité : formes de données du domaine « projets » (branche F).
 * Matérialise le triplet projet ↔ worktree ↔ équipe (F.1, F.2, F.4). Aucune I/O ici.
 */

import type { MotifDeni } from '../plancher-deni/index.ts';

export type IdProjet = string;
export type IdEquipe = string;

// ---------------------------------------------------------------------------
// F.1.2 — configuration déclarative par fichier (un fichier par projet)
// ---------------------------------------------------------------------------

/** Forme brute lue depuis le disque, avant toute validation — tout est `unknown`. */
export interface ConfigProjetBrute {
  readonly id?: unknown;
  readonly cheminDepot?: unknown;
  readonly brancheDefaut?: unknown;
  readonly budgetMaxUsd?: unknown;
  readonly modeleDefaut?: unknown;
  readonly deniedToolPatternsSupplementaires?: unknown;
  readonly agentTeamsActif?: unknown;
  readonly mandatType?: unknown;
}

/**
 * Motifs de refus stables, testables. Un seul critère de nommage : dire *quoi*
 * a échoué sans avoir à relire un message libre (aligné sur `PreflightFailureCode`
 * de `workers/types.ts`, même esprit).
 */
export type CodeEchecValidationProjet =
  | 'forme_invalide'
  | 'json_invalide'
  | 'id_manquant_ou_invalide'
  | 'id_deja_charge_dans_ce_lot'
  | 'chemin_depot_manquant'
  | 'chemin_depot_introuvable'
  | 'chemin_depot_pas_un_repertoire'
  | 'branche_defaut_manquante_pour_depot_git'
  | 'branche_defaut_sur_projet_non_git'
  | 'branche_defaut_introuvable'
  | 'budget_invalide'
  | 'modele_defaut_invalide'
  | 'motif_deni_supplementaire_invalide'
  | 'motif_deni_supplementaire_non_scope'
  | 'motif_deni_supplementaire_id_duplique';

export interface EchecValidationProjet {
  readonly code: CodeEchecValidationProjet;
  readonly detail: string;
}

/**
 * Projet validé, disponible pour dispatch. Construit **uniquement** quand la
 * validation complète a réussi (F.4.2) — pas de forme intermédiaire « partielle ».
 */
export interface ConfigProjet {
  readonly id: IdProjet;
  readonly cheminDepot: string;
  /** `false` ⇒ mode dégradé F.1.3, à signaler tel quel — jamais simulé. */
  readonly estGit: boolean;
  /** `null` uniquement quand `estGit` est `false` (F.1.3). */
  readonly brancheDefaut: string | null;
  readonly budgetMaxUsd: number;
  /** Alias ou identifiant concret, déjà prouvé ≥ plancher Sonnet (H-43). */
  readonly modeleDefaut: string;
  readonly deniedToolPatternsSupplementaires: readonly MotifDeni[];
  readonly agentTeamsActif: boolean;
  readonly mandatType: string;
  /** Miroir de `estGit` — nommé côté sens pour l'UI/le registre (F.1.3). */
  readonly isolationGarantie: boolean;
  readonly fichierSource: string;
}

export interface ProjetRejete {
  readonly fichierSource: string;
  readonly idPresume: string | null;
  readonly echecs: readonly EchecValidationProjet[];
}

/** F.4.2 — un projet invalide est écarté et jamais chargé partiellement. */
export interface ResultatChargementProjets {
  readonly projets: readonly ConfigProjet[];
  readonly rejetes: readonly ProjetRejete[];
}

// ---------------------------------------------------------------------------
// F.2 — cycle de vie du worktree
// ---------------------------------------------------------------------------

export type EtatRevendicationWorktree = 'revendiquee' | 'liberee' | 'terminee_non_liberee';

/**
 * Association projet ↔ worktree ↔ équipe (F.1.1, indivisible — H-11).
 * Une instance de cette forme n'existe que pour une revendication enregistrée :
 * il n'y a pas de « cwd » observable sans qu'elle existe (garantie de F.2.1).
 */
export interface RevendicationWorktree {
  readonly idEquipe: IdEquipe;
  readonly projetId: IdProjet;
  readonly cheminDepot: string;
  /** Répertoire à passer en `cwd` au worker. Pour un projet non-git : `cheminDepot` lui-même. */
  readonly worktreePath: string;
  /** `null` en mode dégradé (F.1.3) : pas de worktree, donc pas de branche dédiée. */
  readonly brancheDediee: string | null;
  /** Branche depuis laquelle le worktree a été créé — sert de base à F.2.3. `null` en mode dégradé. */
  readonly brancheParent: string | null;
  readonly epoch: number;
  readonly isolationGarantie: boolean;
  readonly etat: EtatRevendicationWorktree;
  readonly revendiqueeA: number;
  readonly libereeA: number | null;
}
