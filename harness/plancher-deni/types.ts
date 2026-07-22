/**
 * Responsabilité : formes de données du domaine « plancher de déni » (C.1.3, G.2).
 *
 * Le plancher borne l'irréversible, il n'arbitre pas le quotidien (H-41). Chaque
 * motif est une règle **scopée** — jamais un nom d'outil nu, qui amputerait la
 * capacité au lieu de borner le danger (panne #21 de la grille de revue).
 */

/** Outils sur lesquels le plancher s'exprime : commandes shell et écriture de fichiers. */
export type OutilCible = 'Bash' | 'Write' | 'Edit';

export interface MotifDeni {
  /** Identifiant stable pour le journal et les tests — jamais l'index du tableau. */
  readonly id: string;
  /** Outil ciblé. Toujours accompagné de `contenuRegle` non vide (panne #21). */
  readonly outil: OutilCible;
  /** Contenu de la règle, tel que placé entre parenthèses dans `disallowedTools`. */
  readonly contenuRegle: string;
  /** Ce que le motif borne, en une phrase — pour l'audit et la revue humaine (C.5.1). */
  readonly porte: string;
  /** Pourquoi ce motif ne se déclenche pas sur le travail courant. */
  readonly nonQuotidien: string;
}

/** Forme complète transmise au SDK : `disallowedTools` attend `"Outil(contenu)"`. */
export function formatterRegleSdk(motif: MotifDeni): string {
  return `${motif.outil}(${motif.contenuRegle})`;
}
