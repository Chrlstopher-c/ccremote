// Responsabilité : la minuterie des tâches planifiées (P7) — un tour toutes les 30 s, sans chevauchement ; chaque tour
// confie la vérification au service de tâches. Arrêtée par le poste à sa fermeture.
import type { Logger } from 'pino';
import { PERIODE_TACHES_MS } from '../../commun/reste-lot2.ts';

export interface VerificateurTaches {
  verifier(): Promise<void>;
}

export class MinuterieTaches {
  private minuterie: ReturnType<typeof setInterval> | null = null;
  private occupee = false;

  constructor(
    private readonly taches: VerificateurTaches,
    private readonly journal: Logger,
    private readonly periodeMs: number = PERIODE_TACHES_MS,
  ) {}

  demarrer(): void {
    if (this.minuterie !== null) return;
    this.minuterie = setInterval(() => void this.tour(), this.periodeMs);
  }

  arreter(): void {
    if (this.minuterie !== null) clearInterval(this.minuterie);
    this.minuterie = null;
  }

  /** Un tour : s'il en reste un en cours, celui-ci est sauté. */
  async tour(): Promise<void> {
    if (this.occupee) return;
    this.occupee = true;
    try {
      await this.taches.verifier();
    } catch (erreur) {
      this.journal.error({ err: erreur }, 'minuterie des tâches : tour en échec');
    } finally {
      this.occupee = false;
    }
  }
}
