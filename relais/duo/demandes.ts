// Responsabilité : les demandes du pair qui attendent l'accord du propriétaire. Une demande se tranche par la route
// ou par son expiration (refusée sans réponse) ; chaque changement est diffusé aux clients. Un accord peut porter le
// dossier choisi (passer la main : où s'ouvre la session neuve).
import type { ChoixDossier, DemandeDuo, GenreDemande } from '../../commun/duo.ts';
import type { Diffusion } from '../clients/diffusion.ts';
import { nonce } from './preuve.ts';

export interface OptionsDemandes {
  readonly diffusion: Diffusion;
  readonly horloge: () => number;
  readonly delaiMs: number;
}

export interface Reponse {
  readonly accord: boolean;
  readonly choix?: ChoixDossier;
  /** Vrai quand la demande a expiré faute de réponse de Chris (et non parce qu'il a refusé). */
  readonly expiree?: boolean;
}

const REFUS: Reponse = { accord: false };
const EXPIREE: Reponse = { accord: false, expiree: true };

interface Attente {
  readonly demande: DemandeDuo;
  readonly rendre: (r: Reponse) => void;
  readonly minuterie: ReturnType<typeof setTimeout>;
}

export class Demandes {
  private readonly en = new Map<string, Attente>();

  constructor(private readonly options: OptionsDemandes) {}

  /**
   * Rend la décision de Chris ; un refus rend `accord: false`, un délai sans réponse aussi mais avec `expiree: true`.
   * `surEnvoi` reçoit la demande dès qu'elle est enregistrée, avant que Chris ne réponde.
   */
  demander(
    genre: GenreDemande,
    de: string,
    detail: string,
    session?: string,
    resume?: string,
    surEnvoi?: (demande: DemandeDuo) => void,
  ): Promise<Reponse> {
    return new Promise((rendre) => {
      const id = nonce();
      const le = new Date(this.options.horloge()).toISOString();
      const demande: DemandeDuo = {
        ...{ id, genre, de, le, detail },
        ...(session ? { session } : {}),
        ...(resume ? { resume } : {}),
      };
      const minuterie = setTimeout(() => this.trancher(id, EXPIREE), this.options.delaiMs);
      this.en.set(id, { demande, rendre, minuterie });
      surEnvoi?.(demande);
      this.options.diffusion.diffuser({ type: 'duo_demande', demande });
    });
  }

  lister(): DemandeDuo[] {
    return [...this.en.values()].map((a) => a.demande);
  }

  /** Faux si la demande n'existe pas (déjà tranchée ou expirée). */
  decider(id: string, accord: boolean, choix?: ChoixDossier): boolean {
    return this.trancher(id, accord ? { accord, ...(choix ? { choix } : {}) } : REFUS);
  }

  arreter(): void {
    for (const id of [...this.en.keys()]) this.trancher(id, REFUS);
  }

  private trancher(id: string, reponse: Reponse): boolean {
    const attente = this.en.get(id);
    if (!attente) return false;
    clearTimeout(attente.minuterie);
    this.en.delete(id);
    attente.rendre(reponse);
    this.options.diffusion.diffuser({ type: 'duo_modifie' });
    return true;
  }
}
