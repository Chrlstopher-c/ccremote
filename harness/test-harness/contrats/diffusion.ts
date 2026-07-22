// Contrat du canal d'observation (branche E.2.3).
// Invariant : un client lent ne ralentit JAMAIS le worker (panne #29).
// Bourrage borné, abandon des plus anciens, reprise au numéro de séquence (D.2.2).

export interface EvenementObservation {
  /** High-water mark : monotone croissant, par équipe (D.2.2). */
  readonly sequence: number;
  readonly idEquipe: string;
  readonly charge: Readonly<Record<string, unknown>>;
}

export interface DiffusionObservation {
  abonner(idClient: string, capacite: number, depuisSequence: number): void;
  /**
   * Publication depuis le worker. **Doit rendre la main immédiatement**
   * et ne jamais exercer de contre-pression vers l'amont.
   */
  publier(evenement: EvenementObservation): void;
  /** Le client tire ce qu'il peut absorber. */
  consommer(idClient: string, quantite: number): readonly EvenementObservation[];
  abandonnes(idClient: string): number;
  /** Dernière séquence remise à ce client. `0` = rattachement neuf. */
  hautNiveau(idClient: string): number;
  /** Compteur de blocages du producteur. Doit rester à 0. */
  blocagesProducteur(): number;
}
