// Contrat de temps contrôlé. Le harness ne fournit QUE l'implémentation simulée :
// toute horloge réelle (setTimeout, Date.now) appartient au code de production.
// Cf. règle de déterminisme M-04 : aucune panne injectée ne dépend du temps réel.

export type AnnulerMinuterie = () => void;

export interface Horloge {
  /** Instant courant en millisecondes, monotone. */
  maintenant(): number;
  /** Planifie `action` dans `delaiMs`. Retourne un annulateur idempotent. */
  planifier(delaiMs: number, action: () => void): AnnulerMinuterie;
  /** Attend `delaiMs`. Sur horloge simulée, ne se résout qu'après `avancer()`. */
  attendre(delaiMs: number): Promise<void>;
}

/** Source d'aléa reproductible. Même graine ⇒ même suite, toujours. */
export interface Alea {
  /** Flottant dans [0, 1). */
  suivant(): number;
  /** Entier dans [0, borneExclue). */
  entier(borneExclue: number): number;
  /** `true` avec la probabilité donnée. */
  tirage(probabilite: number): boolean;
}
