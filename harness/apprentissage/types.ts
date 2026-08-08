/**
 * Responsabilité : formes de données du domaine « apprentissage ». Aucune I/O ici.
 *
 * Conception inspirée de Hermes Agent (Nous Research) — MIT. Transposition indépendante en TypeScript.
 * Référence : `Upgrade/apprentissage/SPEC-APPRENTISSAGE.md` §5.
 */

/**
 * Comment une mission s'est terminée (C-2, §5 SPEC — table de décision C-2).
 * `☠` `inconnue` est la valeur de repli d'une mission jamais mesurée (`constatGit === null`)
 * — elle n'alimente jamais aucune leçon. Ne jamais la confondre avec `livree`.
 */
export type IssueMission =
  | 'livree'
  | 'livree_partielle'
  | 'sans_effet'
  | 'boucle'
  | 'budget_epuise'
  | 'interrompue'
  | 'echec_technique'
  | 'inconnue';

/** Un outil appelé pendant la mission, réduit à ce qui sert C-3/C-5. */
export interface UsageOutil {
  readonly nom: string;
  readonly appels: number;
  readonly echecs: number;
}

/** Un sous-agent observé sur disque (voir `superviseur/sous-agents-disque.ts`). */
export interface SousAgentResume {
  readonly type: string | null;
  readonly description: string | null;
}

/**
 * Résumé borné d'une mission (C-1, SPEC §5.1) — la seule forme qu'un modèle 8B voit
 * jamais. Doit tenir sous 2 000 tokens quelle que soit la taille du transcript source.
 */
export interface ResumeMission {
  readonly missionId: string;
  readonly sessionId: string;
  /** Chemin du dépôt, pas le worktree. */
  readonly projet: string;
  /** 400 caractères max, tête du mandat. */
  readonly mandatResume: string;
  readonly critereArret: string | null;
  readonly issue: IssueMission;
  readonly dureeMs: number;
  readonly nbTours: number;
  readonly outils: readonly UsageOutil[];
  /** Messages d'erreur d'outil normalisés, ≤ 10, dédupliqués. */
  readonly erreurs: readonly string[];
  /** ≤ 30, chemins relatifs au projet. */
  readonly fichiersTouches: readonly string[];
  /** ≤ 10, commande + code de sortie. */
  readonly commandesEchouees: readonly string[];
  readonly sousAgents: readonly SousAgentResume[];
  /** 1 500 caractères max du dernier message assistant. */
  readonly extraitFinal: string;
}

/** Catégorie d'une leçon (SPEC §5.7). */
export type CategorieLecon = 'outil' | 'projet' | 'methode' | 'piege';

/** Portée d'une leçon ou d'une compétence (SPEC §5.7/§5.8). */
export type Portee = 'projet' | 'machine' | 'global';

/** Cycle de vie d'une leçon (SPEC §1, §5.4) — `candidate` n'est jamais servie. */
export type EtatLecon = 'candidate' | 'active' | 'dormante' | 'obsolete';

/** Une leçon telle que persistée dans `apprentissage.db`, table `lecon` (SPEC §5.7). */
export interface Lecon {
  readonly id: string;
  /** Chemin du dépôt ; `'*'` pour une portée globale. */
  readonly projet: string;
  readonly machine: string | null;
  readonly enonce: string;
  readonly categorie: CategorieLecon;
  readonly portee: Portee;
  readonly etat: EtatLecon;
  readonly confirmations: number;
  readonly contradictions: number;
  readonly creeeA: number;
  readonly derniereConfirmationA: number;
  readonly servieCount: number;
}

/** Champs nécessaires à la création d'une leçon ; les compteurs sont dérivés par le dépôt. */
export interface CreationLecon {
  readonly id: string;
  readonly projet: string;
  readonly machine?: string | null;
  readonly enonce: string;
  readonly categorie: CategorieLecon;
  readonly portee: Portee;
  readonly etat?: EtatLecon;
  readonly creeeA?: number;
}

/** Sens d'une observation de rapprochement (C-5). */
export type SensObservation = 'confirme' | 'contredit';

/** Une ligne `lecon_observation` — provenance d'une confirmation/contradiction (SPEC §5.7). */
export interface LeconObservation {
  readonly leconId: string;
  readonly missionId: string;
  readonly sens: SensObservation;
  readonly preuve: string;
  readonly observeeA: number;
}

/** Trace d'une passe d'apprentissage sur une mission — clé d'idempotence (SPEC §5.7 `☠`). */
export interface PasseApprentissage {
  readonly missionId: string;
  readonly traiteeA: number;
  readonly issue: IssueMission;
  readonly leconsExtraites: number;
  /** Non `null` ⇒ passe échouée, rejouable. */
  readonly erreur: string | null;
}

/** Cycle de vie d'une compétence — même vocabulaire que `EtatLecon` (SPEC §5.8). */
export type EtatCompetence = 'candidate' | 'active' | 'dormante' | 'obsolete';

/** Une compétence, telle qu'écrite en fichier sous `competences/<slug>/COMPETENCE.md` (SPEC §5.8). */
export interface Competence {
  readonly slug: string;
  readonly nom: string;
  readonly description: string;
  readonly portee: Portee;
  readonly projet: string | null;
  readonly etat: EtatCompetence;
  readonly confirmations: number;
  /** Identifiants de mission à l'origine de la compétence. */
  readonly origine: readonly string[];
  /** Date ISO de dernière modification du fichier. */
  readonly maj: string;
}

/**
 * Opération structurée proposée par le modèle local pour amender une compétence
 * (SPEC §5.8 `☠`) — le modèle ne produit JAMAIS de contenu de fichier, seulement l'une
 * de ces opérations ; le harness l'applique de façon déterministe.
 */
export type OperationCompetence =
  | {
      readonly type: 'creer';
      readonly nom: string;
      readonly description: string;
      /** ≤ 3 lignes. */
      readonly quand: readonly string[];
      /** ≤ 5 lignes. */
      readonly etapes: readonly string[];
    }
  | { readonly type: 'ajouter_piege'; readonly slug: string; readonly ligne: string }
  | { readonly type: 'ajouter_etape'; readonly slug: string; readonly ligne: string; readonly apresEtape: number }
  | { readonly type: 'rien' };
