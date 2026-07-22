// Contrat du transport Pi↔PC vu par le harness (branche D).
// Invariant H-12 : le transport ne lit jamais le contenu. Il déplace des octets.

/** Codes de fermeture de la taxonomie D.2.1, transposée du bridge Anthropic. */
export type CodeFermeture = 401 | 403 | 404 | 4090 | 4091 | 4092;

export interface FermetureTerminale {
  readonly terminal: true;
  readonly code: CodeFermeture;
  readonly raison: string;
  /** `false` pour 4090 : epoch dépassé ⇒ abandonner, ne PAS reconnecter. */
  readonly rattachementAutorise: boolean;
}

export type EtatLien = 'ouvert' | 'coupe_transitoire' | 'ferme_terminal';

/** Politique d'intégrité d'un tuyau d'octets (D.1.3). */
export type ModeIntegrite = 'strict' | 'perte_silencieuse';

/** Levée par un tuyau `strict` qui constate une perte. « Échouer bruyamment. » */
export class ErreurIntegriteTuyau extends Error {
  constructor(
    readonly attendus: number,
    readonly recus: number,
  ) {
    super(`Intégrité du tuyau rompue : ${attendus} octets émis, ${recus} reçus`);
    this.name = 'ErreurIntegriteTuyau';
  }
}

/** Canal unidirectionnel d'octets opaques. */
export interface Tuyau {
  ecrire(octets: Uint8Array): void;
  surOctets(abonne: (octets: Uint8Array) => void): void;
  octetsEmis(): number;
  octetsRecus(): number;
}

/**
 * Lien bidirectionnel Pi↔PC.
 * `remonteesTransitoires()` doit rester à 0 : le transport absorbe le transitoire
 * en silence (panne #28 de la grille de revue).
 */
export interface Lien {
  etat(): EtatLien;
  versPc(): Tuyau;
  versPi(): Tuyau;
  surFermeture(abonne: (fermeture: FermetureTerminale) => void): void;
  remonteesTransitoires(): number;
  /** Nombre de rattachements à froid effectués depuis la création. */
  rattachements(): number;
}

/**
 * Forme structurellement compatible avec `SpawnedProcess` du SDK 0.3.217.
 * Le harness expose un adaptateur ; brancher de vrais flux Node appartient
 * à l'implémentation réelle du transport, jamais au harness.
 */
export interface ProcessusDistant {
  readonly killed: boolean;
  readonly exitCode: number | null;
  readonly signalCode: string | null;
  kill(signal: string): boolean;
}
