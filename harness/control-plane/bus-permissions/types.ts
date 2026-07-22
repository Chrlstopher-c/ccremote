/**
 * Responsabilité : formes de données de la machine à états des demandes de
 * permission (branche C.2/C.3, mission M-21). Aucune I/O ici.
 *
 * Mirroir intentionnel de `test-harness/contrats/permissions.ts` (mêmes noms de
 * champs pour `EntreeDemande`/`Verdict`). Dupliqué plutôt qu'importé :
 * `test-harness` est un outil de test, aucun module de production ne doit en
 * dépendre (test-harness/README.md, règle 1). Duplication accidentelle assumée
 * (code-standards.md, DRY business vs accidentel) — la doublure sert à injecter
 * des pannes en mémoire pour d'autres missions, ce module sert la production.
 *
 * ☠ Hors périmètre M-21, volontairement absent d'ici :
 *  - le canal hors-bande de C.2.3 (`requestId` + retour `null` confirmé) → M-23
 *  - la trace d'audit et l'arbitrage délégué de C.5 → M-22
 */

/**
 * Six états de C.2.1. `repondue` ≠ `confirmee` : l'écart est exactement
 * l'endroit où se cache l'agent bloqué (invariant I-5).
 */
export type EtatDemande =
  | 'recue'
  | 'resolue_auto'
  | 'en_attente'
  | 'repondue'
  | 'confirmee'
  | 'caduque';

export type Verdict =
  | { readonly behavior: 'allow'; readonly updatedInput?: Readonly<Record<string, unknown>> }
  | { readonly behavior: 'deny'; readonly message: string; readonly interrupt?: boolean };

/** Ce que porte l'arrivée d'une demande, escaladée ou non. */
export interface EntreeDemande {
  readonly requestId: string;
  readonly idWorker: string;
  readonly outil: string;
  readonly decisionReason?: string;
  readonly blockedPath?: string;
  readonly agentId?: string;
}

/** Vue exposée d'une demande suivie par la machine à états. */
export interface DemandePermission extends EntreeDemande {
  readonly etat: EtatDemande;
  readonly verdict: Verdict | null;
  readonly recueA: number;
  readonly enAttenteDepuisA: number | null;
  readonly repondueA: number | null;
  readonly confirmeeA: number | null;
}

/**
 * Résultat de `redelivrer` (C.3.1/C.3.2) — donne à l'appelant de quoi agir sans
 * dupliquer de logique de décision côté transport/canal humain.
 */
export type ResultatRedelivrance =
  | { readonly action: 'nouvelle_escalade' }
  | { readonly action: 'deja_en_file' }
  | { readonly action: 'verdict_a_reemettre'; readonly verdict: Verdict }
  | { readonly action: 'refusee' }
  | { readonly action: 'ignoree_pre_escalade' };

/**
 * Port de temps minimal du domaine, pour rendre les balayages I-1/I-5
 * injectables en test sans jamais dépendre de `test-harness` (même motif que
 * `transport/horloge-transport.ts`).
 */
export interface HorlogeBus {
  maintenant(): number;
}

export const HORLOGE_REELLE_BUS: HorlogeBus = {
  maintenant: () => Date.now(),
};
