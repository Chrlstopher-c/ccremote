/**
 * Responsabilité : garde-fous exécutables du plancher (panne #21, mission M-20).
 * Rejoue à la composition ce que la revue humaine vérifierait à l'œil — sauf
 * que l'œil se trompe, pas le test (15-grille-revue.md, ligne « je crois que
 * oui vaut non »).
 */

import type { MotifDeni } from './types.ts';
import { MAX_MOTIFS_PLANCHER } from './motifs.ts';

export class MotifNonScopeError extends Error {
  constructor(readonly motif: MotifDeni) {
    super(
      `Motif "${motif.id}" sans contenuRegle : nom d'outil nu, ampute la capacité au lieu ` +
        `de borner le danger (panne #21 de la grille de revue).`,
    );
    this.name = 'MotifNonScopeError';
  }
}

export class PlancherTropLargeError extends Error {
  constructor(
    readonly nombre: number,
    readonly plafond: number,
  ) {
    super(
      `${nombre} motifs > plafond ${plafond} : un plancher qui se déclenche au quotidien ` +
        `sera contourné par l'opérateur — c'est le mode de défaillance à éviter.`,
    );
    this.name = 'PlancherTropLargeError';
  }
}

/**
 * `☠ CASSE` — un motif dont `contenuRegle` est vide ou absent équivaut à un nom
 * d'outil nu : il retire l'outil du contexte au lieu de borner un usage précis.
 */
export function assertMotifsScopes(motifs: readonly MotifDeni[]): void {
  for (const motif of motifs) {
    if (motif.contenuRegle.trim().length === 0) {
      throw new MotifNonScopeError(motif);
    }
  }
}

/** Le plafond n'est pas cosmétique : au-delà, le plancher devient du bruit quotidien. */
export function assertPlancherBorne(motifs: readonly MotifDeni[], plafond = MAX_MOTIFS_PLANCHER): void {
  if (motifs.length > plafond) {
    throw new PlancherTropLargeError(motifs.length, plafond);
  }
}

/** Un identifiant ne doit apparaître qu'une fois — sinon l'audit (C.5.1) devient ambigu. */
export function assertIdsUniques(motifs: readonly MotifDeni[]): void {
  const vus = new Set<string>();
  for (const motif of motifs) {
    if (vus.has(motif.id)) {
      throw new Error(`Identifiant de motif dupliqué : "${motif.id}".`);
    }
    vus.add(motif.id);
  }
}

/** Passe unique regroupant les trois garde-fous — à appeler avant tout usage du plancher. */
export function validerPlancher(motifs: readonly MotifDeni[]): void {
  assertMotifsScopes(motifs);
  assertPlancherBorne(motifs);
  assertIdsUniques(motifs);
}
