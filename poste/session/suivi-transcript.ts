// Responsabilité : le suivi d'un transcript Claude Code d'une session non pilotée ici (découverte, adoptée, ou fermée au
// démarrage). Chaque écriture part au fil dans la seconde : le fichier est surveillé, et le balayage périodique n'est
// qu'un filet. Seule la suite part, avec quelques événements déjà envoyés en chevauchement pour que le relais retrouve
// son ancre. Une réécriture ou une branche cassée repart d'une relecture complète (voir lecture-incrementale.ts).
import { statSync } from 'node:fs';
import type { Logger } from 'pino';
import type { LireImageChemin } from '../presentation/images-chemin.ts';
import type { EvenementHorodate, StockerImage } from './historique.ts';
import { LectureIncrementale } from './lecture-incrementale.ts';
import { SurveillanceFichier } from './surveillance-fichier.ts';

export const ANTI_REBOND_MS = 150;
export const CHEVAUCHEMENT = 100; // relecture complète : événements repris avant la queue, pour retrouver l'ancre
export const RECENT_MS = 30 * 60_000; // transcript modifié depuis moins longtemps : relu dès la première vue
export const CHEVAUCHEMENT_DIRECT = 5; // suite au fil : derniers événements déjà envoyés, repris devant les nouveaux

export interface DependancesSuivi {
  readonly journal: Logger;
  readonly emettre: (evenements: readonly EvenementHorodate[], direct: boolean) => void; // direct : suite écrite en direct
  readonly stockerImage?: StockerImage;
  readonly lireChemin?: LireImageChemin;
  readonly antiRebondMs?: number;
  readonly recentMs?: number;
}

export class SuiviTranscript {
  private lecture: LectureIncrementale | null = null;
  private surveillance: SurveillanceFichier | null = null;
  private envoyes: number | null = null; // événements de la branche déjà envoyés ; null : le relais n'a rien, tout part
  private recents: EvenementHorodate[] = []; // derniers envoyés : le chevauchement de la suite

  constructor(private readonly d: DependancesSuivi) {}

  /** Relecture complète : la queue part (voir CHEVAUCHEMENT), ou tout si `complet`. Rend le nombre d'événements. */
  relecture(chemin: string, complet = false): number {
    const evenements = this.lecturePour(chemin).relireTout();
    this.envoyerQueue(evenements, complet);
    return evenements.length;
  }

  /** Appelé à chaque écriture (surveillance) et par le balayage (filet) : n'envoie que ce qui s'est ajouté. */
  verifier(chemin: string): void {
    this.surveillancePour(chemin).armer();
    const lecture = this.lecturePour(chemin);
    if (!lecture.etablie) {
      // Transcript écrit récemment : le relais a pu manquer ses dernières lignes (poste ou appli relancés entre-temps),
      // sa queue part tout de suite au lieu d'attendre la prochaine écriture.
      if (ecritRecemment(chemin, this.d.recentMs ?? RECENT_MS)) this.relecture(chemin);
      else this.etablir(lecture);
      return;
    }
    const ajout = lecture.ajout();
    if (ajout === null || (ajout.length > 0 && this.envoyes === null)) {
      this.relecture(chemin);
      return;
    }
    if (ajout.length > 0) this.envoyerSuite(ajout);
  }

  /** Arrête la surveillance et oublie la base : la prochaine vue repart d'une première vue (session pilotée ici, ou fin). */
  reinitialiser(): void {
    this.surveillance?.arreter();
    this.surveillance = null;
    this.lecture = null;
    this.envoyes = null;
    this.recents = [];
  }

  // Première vue : ce qui existe déjà n'est pas relu ; la première écriture qui suit relit tout (le relais peut
  // n'avoir rien de ce transcript).
  private etablir(lecture: LectureIncrementale): void {
    lecture.etablirALaFin();
    this.envoyes = null;
    this.recents = [];
  }

  private lecturePour(chemin: string): LectureIncrementale {
    if (this.lecture?.chemin !== chemin) {
      this.lecture = new LectureIncrementale(chemin, this.d.journal, this.d.stockerImage, this.d.lireChemin);
      this.envoyes = null;
      this.recents = [];
    }
    return this.lecture;
  }

  private surveillancePour(chemin: string): SurveillanceFichier {
    if (this.surveillance?.chemin !== chemin) {
      this.surveillance?.arreter();
      const antiRebondMs = this.d.antiRebondMs ?? ANTI_REBOND_MS;
      this.surveillance = new SurveillanceFichier(chemin, () => this.verifier(chemin), this.d.journal, antiRebondMs);
    }
    return this.surveillance;
  }

  private envoyerQueue(evenements: readonly EvenementHorodate[], complet: boolean): void {
    const retrecie = this.envoyes !== null && evenements.length < this.envoyes;
    const debut = complet || this.envoyes === null || retrecie ? 0 : Math.max(0, this.envoyes - CHEVAUCHEMENT);
    this.envoyes = evenements.length;
    this.recents = evenements.slice(-CHEVAUCHEMENT_DIRECT);
    this.d.emettre(evenements.slice(debut), false);
  }

  private envoyerSuite(ajout: readonly EvenementHorodate[]): void {
    const envoi = [...this.recents, ...ajout];
    this.envoyes = (this.envoyes ?? 0) + ajout.length;
    this.recents = envoi.slice(-CHEVAUCHEMENT_DIRECT);
    this.d.emettre(envoi, true);
  }
}

function ecritRecemment(chemin: string, recentMs: number): boolean {
  try {
    return recentMs > 0 && Date.now() - statSync(chemin).mtimeMs < recentMs;
  } catch {
    return false;
  }
}
