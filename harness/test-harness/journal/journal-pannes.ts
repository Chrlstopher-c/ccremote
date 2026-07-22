// Journal ordonné des faits. C'est la surface d'assertion unique du harness :
// un test lit le journal, il ne mesure ni délai réel ni sortie console.

import type { Horloge } from '../contrats/horloge.ts';
import type { Fait, TypeFait } from './faits.ts';
import { logger } from '../logger.ts';

export class JournalPannes {
  readonly #faits: Fait[] = [];

  constructor(private readonly horloge: Horloge) {}

  enregistrer(type: TypeFait, details: Readonly<Record<string, unknown>> = {}): void {
    const fait: Fait = { a: this.horloge.maintenant(), type, details };
    this.#faits.push(fait);
    logger.debug({ fait }, 'fait de harness');
  }

  faits(): readonly Fait[] {
    return this.#faits;
  }

  filtrer(type: TypeFait): readonly Fait[] {
    return this.#faits.filter((f) => f.type === type);
  }

  compter(type: TypeFait): number {
    return this.filtrer(type).length;
  }

  contient(type: TypeFait): boolean {
    return this.compter(type) > 0;
  }

  /** Vrai si les types apparaissent dans cet ordre relatif (sous-séquence). */
  sequenceRespectee(types: readonly TypeFait[]): boolean {
    let curseur = 0;
    for (const fait of this.#faits) {
      if (curseur < types.length && fait.type === types[curseur]) curseur += 1;
    }
    return curseur === types.length;
  }

  vider(): void {
    this.#faits.length = 0;
  }
}
