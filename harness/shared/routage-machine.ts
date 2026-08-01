/**
 * Responsabilité : le refus de routage vers une machine de travail (migration 22).
 *
 * `☠` Vit dans `shared/` et non dans la composition, alors que c'est elle qui le
 * lève : l'API web doit pouvoir le RECONNAÎTRE pour rendre un 409 lisible plutôt
 * qu'un 500 « erreur interne ». Le control plane n'a pas le droit d'importer la
 * composition (le sens de dépendance serait inversé), donc le type descend ici,
 * là où les deux peuvent le voir. C'est le même arbitrage que pour
 * `acces-mandat.ts` ou `budget-equipe.ts`.
 */

/**
 * `☠` Le message porte TOUJOURS la liste des machines utilisables. L'appelant
 * est souvent un modèle (l'orchestrateur, via un outil MCP) : un refus nu ne lui
 * apprend rien et il réémettra la même valeur au tour suivant, tandis qu'une
 * liste le corrige immédiatement (`rules/code-standards.md`, « Model output is
 * untrusted input »). Vrai aussi pour un humain devant l'interface.
 */
export class ErreurRoutageMachine extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ErreurRoutageMachine';
  }
}
