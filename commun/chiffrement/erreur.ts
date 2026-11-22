// Responsabilité : erreur unique du chiffrement de bout en bout — un refus est toujours une exception explicite.
export class ErreurChiffrement extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ErreurChiffrement';
  }
}
