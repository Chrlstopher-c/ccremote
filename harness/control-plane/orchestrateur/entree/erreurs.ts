/**
 * Responsabilité : erreurs typées du slice « entrée ».
 */

/** Levée quand on dépose dans une file déjà close. */
export class FileFermeeErreur extends Error {
  override readonly name = 'FileFermeeErreur'
}

/** Levée quand on tente de consommer une seconde fois le flux d'entrée. */
export class FluxDejaConsommeErreur extends Error {
  override readonly name = 'FluxDejaConsommeErreur'
}
