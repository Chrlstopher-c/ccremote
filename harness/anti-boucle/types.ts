/**
 * Responsabilité : formes de données du domaine « anti-boucle » (H-68, mission M-53).
 * Aucune I/O ici.
 *
 * ☠ Rappel structurant (H-68, corrige H-58) : le dollar n'est PLUS un détecteur de
 * boucle ni une limite — c'est un déclencheur d'inspection. Ce domaine ne juge jamais
 * sur le seul montant : il déclenche une inspection à un palier, extrait des signaux
 * bon marché des N derniers tours (jamais le transcript complet), fait juger un modèle
 * Haiku dédié, et applique un biais asymétrique non négociable — dans le doute, on
 * laisse continuer.
 */

import type { Options, Query } from '@anthropic-ai/claude-agent-sdk';

/** Un outil appelé pendant un tour, réduit à ce qui sert la détection de boucle. */
export interface OutilAppele {
  readonly nom: string;
  readonly cible: string;
}

/** Un fichier touché pendant un tour. `empreinte` : hash court, jamais le contenu. */
export interface FichierModifie {
  readonly chemin: string;
  readonly empreinte?: string;
}

/**
 * Résumé bon marché d'UN tour — jamais le transcript complet (H-68 : le juge doit
 * rester bon marché, c'est la moitié de sa raison d'être). Construit par l'appelant
 * (superviseur) à partir du flux qu'il observe déjà.
 */
export interface ResumeTour {
  readonly index: number;
  readonly outils: readonly OutilAppele[];
  readonly erreur: string | null;
  readonly fichiersModifies: readonly FichierModifie[];
  readonly testsEchoues: readonly string[];
}

/** Paliers de déclenchement en dollars — des déclencheurs, jamais des limites (H-68). */
export interface ConfigPaliers {
  readonly seuilsUsd: readonly number[];
}

/** Base opérateur (H-68) : resserrée au début, écartée ensuite. Configurable, jamais figée en dur. */
export const PALIERS_PAR_DEFAUT: ConfigPaliers = {
  seuilsUsd: [12, 30, 50, 70, 100, 120, 150, 170, 200],
};

/** Progression au sein des paliers d'UNE mission — à conserver par l'appelant entre appels. */
export interface EtatPaliers {
  /** Index (dans `seuilsUsd`) du dernier palier déjà inspecté. `-1` = aucun. */
  readonly dernierPalierInspecteIndex: number;
}

export const ETAT_PALIERS_INITIAL: EtatPaliers = { dernierPalierInspecteIndex: -1 };

/** Résultat de la vérification de franchissement de palier. */
export interface DeclenchementPalier {
  readonly declenche: boolean;
  readonly palierUsd: number | null;
  readonly indexPalier: number | null;
  readonly nouvelEtat: EtatPaliers;
}

/** Un couple (outil, cible) répété — signal « mêmes outils sur les mêmes cibles ». */
export interface OutilRepete {
  readonly nom: string;
  readonly cible: string;
  readonly occurrences: number;
}

/**
 * Signaux extraits des N derniers tours (H-68, liste explicite) :
 * - `outilsMemeCible` : mêmes outils appelés sur les mêmes cibles
 * - `erreurRepetee` : même erreur répétée
 * - `toursSansModification` : aucun fichier modifié depuis plusieurs tours (streak final)
 * - `testsEchouantIdentique` : tests échouant à l'identique sur plusieurs tours
 * - `reecritureAlternee` : réécriture alternée des mêmes lignes (même fichier, empreintes qui cyclent)
 */
export interface SignauxBoucle {
  readonly nombreTours: number;
  readonly outilsMemeCible: readonly OutilRepete[];
  readonly erreurRepetee: { readonly message: string; readonly occurrences: number } | null;
  readonly toursSansModification: number;
  readonly testsEchouantIdentique: readonly string[];
  readonly reecritureAlternee: readonly string[];
}

export type Verdict = 'boucle' | 'progres' | 'incertain';

export interface VerdictJuge {
  readonly verdict: Verdict;
  readonly motif: string;
}

/** Contexte transmis au juge — jamais le transcript, juste de quoi motiver le prompt. */
export interface ContexteJugement {
  readonly missionId: string;
  readonly palierUsd: number;
  readonly coutCourantUsd: number;
}

/**
 * Port injectable (H-68). `☠ Règle d'architecture non négociable` : toute
 * implémentation RÉELLE de ce port doit garder l'appel au SDK strictement en son
 * sein — jamais dans du code partagé avec une doublure de test, sinon les tests
 * injectant la doublure déclenchent quand même un vrai appel réseau (piège déjà payé
 * sur un autre projet, `vitrail-project`).
 */
export interface JugeBoucle {
  juger(signaux: SignauxBoucle, contexte: ContexteJugement): Promise<VerdictJuge>;
}

/**
 * Signature de `query()` du SDK, isolée pour l'injection en test de `juge-haiku.ts`.
 * Le juge est toujours un appel one-shot (un `prompt` texte, jamais un flux d'entrée
 * persistant) — cohérent avec « bon marché » (H-68).
 */
export type AntiBoucleQueryFn = (params: { prompt: string; options?: Options }) => Query;

export type ActionCoupure = 'continuer' | 'couper' | 'escalader';

export interface DecisionCoupure {
  readonly action: ActionCoupure;
  readonly motif: string;
}

/**
 * État d'escalade traversant les paliers d'UNE mission (H-68 : « un incertain répété
 * sur plusieurs paliers consécutifs escalade à l'humain »). À conserver par l'appelant
 * entre deux inspections, comme `EtatPaliers`.
 */
export interface EtatEscalade {
  readonly incertainsConsecutifs: number;
}

export const ETAT_ESCALADE_INITIAL: EtatEscalade = { incertainsConsecutifs: 0 };

export interface ResultatDecision {
  readonly decision: DecisionCoupure;
  readonly nouvelEtat: EtatEscalade;
}
