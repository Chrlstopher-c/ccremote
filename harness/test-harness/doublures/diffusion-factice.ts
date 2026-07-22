// Doublure du canal d'observation. Un client lent ne doit JAMAIS freiner le
// producteur : bourrage borné, abandon des plus anciens (E.2.3, panne #29).
// `contrePressionJusquAuWorker: true` reproduit le défaut pour le tester.

import type { DiffusionObservation, EvenementObservation } from '../contrats/diffusion.ts';
import type { JournalPannes } from '../journal/journal-pannes.ts';

interface EtatClient {
  readonly capacite: number;
  tampon: EvenementObservation[];
  abandonnes: number;
  hautNiveau: number;
}

export interface OptionsDiffusion {
  /** À `true`, un tampon plein bloque `publier()` — le défaut à détecter. */
  readonly contrePressionJusquAuWorker: boolean;
}

export const OPTIONS_DIFFUSION_SAINES: OptionsDiffusion = {
  contrePressionJusquAuWorker: false,
};

export class DiffusionFactice implements DiffusionObservation {
  #blocagesProducteur = 0;
  readonly #clients = new Map<string, EtatClient>();

  constructor(
    private readonly journal: JournalPannes,
    private options: OptionsDiffusion = OPTIONS_DIFFUSION_SAINES,
  ) {}

  configurer(options: Partial<OptionsDiffusion>): void {
    this.options = { ...this.options, ...options };
  }

  abonner(idClient: string, capacite: number, depuisSequence: number): void {
    this.#clients.set(idClient, {
      capacite: Math.max(1, capacite),
      tampon: [],
      abandonnes: 0,
      hautNiveau: depuisSequence,
    });
  }

  publier(evenement: EvenementObservation): void {
    this.journal.enregistrer('evenement_publie', { sequence: evenement.sequence });
    for (const [idClient, etat] of this.#clients) {
      if (evenement.sequence <= etat.hautNiveau) continue;
      this.#deposer(idClient, etat, evenement);
    }
  }

  consommer(idClient: string, quantite: number): readonly EvenementObservation[] {
    const etat = this.#clients.get(idClient);
    if (etat === undefined) return [];
    const lot = etat.tampon.splice(0, Math.max(0, quantite));
    const dernier = lot.at(-1);
    if (dernier !== undefined) etat.hautNiveau = dernier.sequence;
    return lot;
  }

  abandonnes(idClient: string): number {
    return this.#clients.get(idClient)?.abandonnes ?? 0;
  }

  hautNiveau(idClient: string): number {
    return this.#clients.get(idClient)?.hautNiveau ?? 0;
  }

  blocagesProducteur(): number {
    return this.#blocagesProducteur;
  }

  tampon(idClient: string): readonly EvenementObservation[] {
    return this.#clients.get(idClient)?.tampon ?? [];
  }

  #deposer(idClient: string, etat: EtatClient, evenement: EvenementObservation): void {
    if (etat.tampon.length < etat.capacite) {
      etat.tampon.push(evenement);
      return;
    }
    if (this.options.contrePressionJusquAuWorker) {
      this.#blocagesProducteur += 1;
      this.journal.enregistrer('producteur_bloque', { idClient, sequence: evenement.sequence });
      return;
    }
    const evince = etat.tampon.shift();
    etat.abandonnes += 1;
    etat.tampon.push(evenement);
    this.journal.enregistrer('evenement_abandonne', {
      idClient,
      sequence: evince?.sequence ?? null,
    });
  }
}
