/**
 * Modèle du filtrage des règles de déni scopées — à l'usage exclusif des tests
 * de ce dossier.
 *
 * `⚠` Ceci N'EST PAS le moteur de règles réel du CLI Claude Code : ce moteur est
 * fermé, embarqué dans le binaire, et ne s'observe qu'en lançant une vraie
 * session — interdit ici (règle non négociable de la mission). C'est une
 * reproduction volontairement simplifiée de la sémantique documentée
 * (préfixe + wildcard `*`, C.1.3), suffisante pour prouver qu'un motif refuse
 * ce qu'il doit refuser et laisse passer le travail courant. Ce que ce module
 * ne peut PAS prouver : que le binaire réel interprète `*` exactement de la
 * même façon. C'est le risque résiduel assumé et déclaré dans le rapport final.
 *
 * Fondement vérifié repris tel quel (C.1.1, C.1.2) : l'évaluation des règles de
 * déni précède le `permissionMode`. Une règle scopée refuse donc **avant**
 * même que le mode soit consulté, dans tous les modes y compris
 * `bypassPermissions`. Le paramètre `mode` de `simulerArbitrage` ne change donc
 * jamais le verdict de déni — il n'existe que pour que chaque test déclare
 * explicitement dans quel mode il prétend prouver le refus, et ne se trompe
 * jamais de cible (H-40, H-42 : le mode réel de production est `'auto'`,
 * jamais `bypassPermissions`).
 */

import type { MotifDeni } from './types.ts';

export type ModePermission = 'auto' | 'bypassPermissions' | 'default' | 'acceptEdits' | 'dontAsk' | 'plan';

export interface AppelOutil {
  readonly outil: string;
  /** Représentation textuelle de l'appel : commande Bash, ou chemin de fichier ciblé. */
  readonly cible: string;
}

export interface VerdictSimule {
  readonly refuse: boolean;
  readonly motifId: string | null;
}

/**
 * Échappe tout sauf `*`, traite le préfixe conventionnel « deux étoiles suivies
 * d'un slash » (zéro ou plusieurs répertoires, optionnel — convention gitignore
 * reprise pour les motifs Write/Edit), puis convertit le reste des `*` en
 * wildcard libre.
 */
function globVersRegex(motif: string): RegExp {
  const echappe = motif
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*\//g, '(?:.*/)?')
    .replace(/\*/g, '.*');
  return new RegExp(`^${echappe}$`, 's');
}

/**
 * Applique le plancher à un appel d'outil simulé. Parcourt les motifs dans
 * l'ordre ; le premier qui matche gagne (l'ordre n'a pas d'incidence fonctionnelle
 * ici puisque les motifs de ce plancher ne se chevauchent pas par construction).
 */
export function simulerArbitrage(
  motifs: readonly MotifDeni[],
  appel: AppelOutil,
  mode: ModePermission,
): VerdictSimule {
  void mode; // documenté ci-dessus : le déni précède le mode, jamais conditionné par lui (C.1.1).
  for (const motif of motifs) {
    if (motif.outil !== appel.outil) continue;
    if (globVersRegex(motif.contenuRegle).test(appel.cible)) {
      return { refuse: true, motifId: motif.id };
    }
  }
  return { refuse: false, motifId: null };
}
