/**
 * Responsabilité : formes de données du domaine transport (branche D, M-10).
 *
 * Mirroir intentionnel de `test-harness/contrats/transport.ts` (mêmes noms de
 * champs, même sémantique). Dupliqué plutôt qu'importé : `test-harness` est un
 * outil de test, aucun module de production ne doit en dépendre
 * (test-harness/README.md, règle 1). Duplication accidentelle assumée
 * (code-standards.md, DRY business vs accidentel) — les deux définitions
 * changent pour des raisons différentes : celle-ci sert la production, l'autre
 * sert à injecter des pannes en mémoire.
 */

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

/** Politique d'intégrité d'un canal de données (D.1.3). */
export type ModeIntegrite = 'strict' | 'perte_silencieuse';

/** Levée par un canal `strict` qui constate un trou de séquence. « Échouer bruyamment. » */
export class ErreurIntegriteTuyau extends Error {
  constructor(
    readonly seqAttendue: number,
    readonly seqRecue: number,
  ) {
    super(`Intégrité rompue : séquence ${seqAttendue} attendue, ${seqRecue} reçue`);
    this.name = 'ErreurIntegriteTuyau';
  }
}

/** Canal unidirectionnel d'octets opaques (H-12 : jamais interprétés). */
export interface Tuyau {
  ecrire(octets: Uint8Array): void;
  surOctets(abonne: (octets: Uint8Array) => void): void;
  octetsEmis(): number;
  octetsRecus(): number;
}

/**
 * Lien bidirectionnel Pi↔PC — le canal principal (D.1).
 * `remonteesTransitoires()` doit rester à 0 : le transport absorbe le
 * transitoire en silence (panne #28 de la grille de revue).
 */
export interface Lien {
  etat(): EtatLien;
  versPc(): Tuyau;
  versPi(): Tuyau;
  surFermeture(abonne: (fermeture: FermetureTerminale) => void): void;
  remonteesTransitoires(): number;
  /** Nombre de rattachements à froid effectués depuis la création. */
  rattachements(): number;
  /**
   * Coupures silencieuses (ni `close` ni `error`, le socket paraît vivant)
   * détectées par le ping/pong applicatif — dette de M-10 comblée. Chacune
   * a déjà emprunté le même chemin de reprise qu'une coupure signalée.
   */
  coupuresSilencieusesDetectees(): number;
  /** Fermeture volontaire, terminale, jamais reconnectée. */
  fermer(): void;
}

/**
 * Voie de contrôle du processus distant, séparée du canal principal (D.3.1,
 * B.2.3) : kill, stderr, notification de sortie. Peut partager la même
 * connexion physique que `Lien` (multiplexage), jamais le même sens logique.
 */
export interface CanalControleProcessus {
  /** Relaie le signal vers le processus distant. Best-effort si le lien est coupé. */
  envoyerKill(signal: string): void;
  /** Texte de stderr rapatrié — seul canal de diagnostic pour un spawn distant. */
  surStderr(abonne: (texte: string) => void): void;
  /** Notification de fin de process distant, hors flux principal. */
  surExit(abonne: (code: number | null, signal: string | null) => void): void;
  /** Échec de spawn côté PC (le processus n'a jamais démarré) — pas un exit. */
  surErreurSpawn(abonne: (message: string) => void): void;
}

/**
 * Forme structurellement compatible avec `SpawnedProcess` du SDK 0.3.217.
 * Le harness expose un adaptateur (B.2.1) ; brancher de vrais flux Node
 * appartient à `spawn-processus-distant.ts`, jamais au contrat.
 */
export interface ProcessusDistant {
  readonly killed: boolean;
  readonly exitCode: number | null;
  readonly signalCode: string | null;
  kill(signal: string): boolean;
}
