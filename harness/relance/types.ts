/**
 * Responsabilité : formes de données du domaine « relance et classification » (B.3.2, B.3.3).
 *
 * Source de la taxonomie : `TerminalReason` du SDK `0.3.217`
 * (`node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts`, vérifié ligne à ligne), reprise
 * telle quelle dans `Upgrade/05-arbre-B-workers.md` § B.3.2 (mon fichier de branche, qui
 * fait foi ici). `☠` Ne jamais ajouter de raison qui n'existe pas dans ce type — c'est
 * l'invention de taxonomie que la mission interdit explicitement.
 */

import type { TerminalReason } from '@anthropic-ai/claude-agent-sdk';

/** Les six groupes de décision de B.3.2, plus le filet pour l'imprévu (H piège). */
export type GroupeTerminaison =
  | 'fin_normale'
  | 'borne_atteinte'
  | 'volontaire'
  | 'transitoire'
  | 'structurel'
  | 'quota'
  | 'non_couverte';

/** Résultat de la classification d'une sortie de tour. */
export interface ClassificationTerminaison {
  /** Valeur brute reçue — journalisée telle quelle, jamais réinterprétée (piège « inconnue »). */
  readonly raisonBrute: string;
  /** `TerminalReason` reconnu du SDK, `null` si la valeur ne fait pas partie du type vérifié. */
  readonly raisonConnue: TerminalReason | null;
  readonly groupe: GroupeTerminaison;
  /** `true` seulement pour le groupe `transitoire` : c'est le seul cas relançable en v1. */
  readonly relancable: boolean;
}

/** État de compteur porté par le superviseur, une instance par équipe (B.3.3). */
export interface EtatCompteurRelance {
  readonly sessionId: string;
  readonly tentativesEffectuees: number;
  readonly plafond: number;
}

/** Ce que la politique décide de faire d'une sortie de tour. */
export type DecisionRelance =
  | { readonly action: 'rien'; readonly motif: string; readonly classification: ClassificationTerminaison }
  | {
      readonly action: 'relancer';
      readonly motif: string;
      readonly classification: ClassificationTerminaison;
      /** `resume: sessionId` — le contexte est préservé (B.3.3). */
      readonly resume: string;
      /** `false` par défaut : on continue la même session, pas une branche d'exploration. */
      readonly forkSession: false;
      readonly tentative: number;
      readonly delaiMs: number;
    }
  | { readonly action: 'remonter'; readonly motif: string; readonly classification: ClassificationTerminaison }
  | {
      readonly action: 'echec_definitif';
      readonly motif: string;
      readonly classification: ClassificationTerminaison;
      readonly tentativesEffectuees: number;
    };
