// Responsabilité : signaler une écriture dans un transcript, sans le relire. Le fichier est surveillé ; tant qu'il
// n'existe pas (ou qu'il est remplacé), c'est son dossier qui l'est. Une rafale d'écritures ne donne qu'un signal, rendu
// au plus `antiRebondMs` après le premier.
import { type FSWatcher, existsSync, watch } from 'node:fs';
import { basename, dirname } from 'node:path';
import type { Logger } from 'pino';

export class SurveillanceFichier {
  private veilleur: FSWatcher | null = null;
  private cible: string | null = null;
  private minuterie: ReturnType<typeof setTimeout> | null = null;

  constructor(
    readonly chemin: string,
    private readonly surChangement: () => void,
    private readonly journal: Logger,
    private readonly antiRebondMs: number,
  ) {}

  /** Arme la surveillance (sans effet si elle l'est déjà) : le fichier s'il existe, sinon son dossier. */
  armer(): void {
    const cible = existsSync(this.chemin) ? this.chemin : dirname(this.chemin);
    if (this.veilleur !== null && this.cible === cible) return;
    this.fermerVeilleur();
    if (!existsSync(cible)) return;
    try {
      const veilleur = watch(cible, (evenement, nom) => this.surEvenement(evenement, nom));
      veilleur.on('error', (erreur) => {
        this.journal.warn({ err: erreur, chemin: cible }, 'surveillance du transcript interrompue');
        this.fermerVeilleur();
      });
      this.veilleur = veilleur;
      this.cible = cible;
    } catch (erreur) {
      this.journal.warn({ err: erreur, chemin: cible }, 'surveillance du transcript impossible, balayage seul');
    }
  }

  /** Arrête la surveillance et annule le signal en attente. */
  arreter(): void {
    this.fermerVeilleur();
    if (this.minuterie !== null) clearTimeout(this.minuterie);
    this.minuterie = null;
  }

  private surEvenement(evenement: string, nom: string | Buffer | null): void {
    const fichier = this.cible === this.chemin;
    if (!fichier && String(nom) !== basename(this.chemin)) return;
    if (!fichier || evenement === 'rename') this.rearmer();
    this.programmer();
  }

  private rearmer(): void {
    this.fermerVeilleur();
    this.armer();
  }

  private programmer(): void {
    if (this.minuterie !== null) return;
    this.minuterie = setTimeout(() => {
      this.minuterie = null;
      this.surChangement();
    }, this.antiRebondMs);
  }

  private fermerVeilleur(): void {
    this.veilleur?.close();
    this.veilleur = null;
    this.cible = null;
  }
}
