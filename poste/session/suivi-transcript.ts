// Responsabilité : le suivi du transcript d'une session SDK non pilotée ici (découverte, ou fermée au démarrage) — relu
// quand il grossit, au plus une fois par période, et envoyé en queue seulement (le relais retrouve son ancre dans le
// chevauchement). Une session pilotée par le poste ne relit rien : son fil vient du direct.
import { signatureTranscript } from './transcript.ts';

export const PERIODE_RELECTURE_MS = 10_000;
export const CHEVAUCHEMENT = 100; // événements repris avant la queue, pour que le relais retrouve son dernier événement

export class SuiviTranscript {
  private signature: string | null = null; // transcript vu au dernier passage (taille, date)
  private prochaine = 0; // une écriture externe ne relance pas la relecture avant ce moment
  private envoyes: number | null = null; // nombre d'événements de la dernière émission (null : jamais émis)

  constructor(private readonly periodeMs: number = PERIODE_RELECTURE_MS) {}

  /** Le transcript vient d'être lu : son état sert de base aux passages suivants. */
  marquerLu(chemin: string): void {
    this.signature = signatureTranscript(chemin);
  }

  /** Faut-il relire maintenant ? Une première vue ne fait que fixer la base ; sans transcript, rien. */
  aRelire(chemin: string, maintenant: number): boolean {
    const signature = signatureTranscript(chemin);
    if (signature === null) return false;
    if (this.signature === null) {
      this.signature = signature;
      return false;
    }
    if (signature === this.signature || maintenant < this.prochaine) return false;
    this.prochaine = maintenant + this.periodeMs;
    return true;
  }

  /** Session pilotée par le poste : la base est oubliée, la première vue après sa fermeture ne relit rien. */
  reinitialiser(): void {
    this.signature = null;
  }

  /** Ce qui part au relais : tout (première émission, réécriture plus courte, demande complète), sinon la queue. */
  queue<T>(evenements: readonly T[], complet: boolean): readonly T[] {
    const retrecie = this.envoyes !== null && evenements.length < this.envoyes;
    const debut = complet || this.envoyes === null || retrecie ? 0 : Math.max(0, this.envoyes - CHEVAUCHEMENT);
    this.envoyes = evenements.length;
    return evenements.slice(debut);
  }
}
