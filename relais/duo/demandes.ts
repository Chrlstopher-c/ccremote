// Responsabilité : les demandes du pair qui attendent l'accord du propriétaire. Une demande se tranche par la route
// ou par son expiration (refusée sans réponse) ; chaque changement est diffusé aux clients.
import type { DemandeDuo, GenreDemande } from '../../commun/duo.ts';
import type { Diffusion } from '../clients/diffusion.ts';
import { nonce } from './preuve.ts';

export interface OptionsDemandes {
  readonly diffusion: Diffusion;
  readonly horloge: () => number;
  readonly delaiMs: number;
}

interface Attente {
  readonly demande: DemandeDuo;
  readonly rendre: (accord: boolean) => void;
  readonly minuterie: ReturnType<typeof setTimeout>;
}

export class Demandes {
  private readonly en = new Map<string, Attente>();

  constructor(private readonly options: OptionsDemandes) {}

  /** Rend `true` si Chris accorde, `false` s'il refuse ou si le délai passe sans réponse. */
  demander(genre: GenreDemande, de: string, detail: string): Promise<boolean> {
    return new Promise((rendre) => {
      const id = nonce();
      const demande: DemandeDuo = { id, genre, de, le: new Date(this.options.horloge()).toISOString(), detail };
      const minuterie = setTimeout(() => this.trancher(id, false), this.options.delaiMs);
      this.en.set(id, { demande, rendre, minuterie });
      this.options.diffusion.diffuser({ type: 'duo_demande', demande });
    });
  }

  lister(): DemandeDuo[] {
    return [...this.en.values()].map((a) => a.demande);
  }

  /** Faux si la demande n'existe pas (déjà tranchée ou expirée). */
  decider(id: string, accord: boolean): boolean {
    return this.trancher(id, accord);
  }

  arreter(): void {
    for (const id of [...this.en.keys()]) this.trancher(id, false);
  }

  private trancher(id: string, accord: boolean): boolean {
    const attente = this.en.get(id);
    if (!attente) return false;
    clearTimeout(attente.minuterie);
    this.en.delete(id);
    attente.rendre(accord);
    this.options.diffusion.diffuser({ type: 'duo_modifie' });
    return true;
  }
}
