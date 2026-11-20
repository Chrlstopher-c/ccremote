// Responsabilité : déclencher la synchronisation du dossier des modules après 300 ms sans écriture, et un balayage
// périodique comme filet (dossier créé après coup, événement manqué). Le dossier n'est jamais créé ici.
import { type FSWatcher, existsSync, watch } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Logger } from 'pino';
import type { MessagePoste } from '../../commun/protocole-poste.ts';
import { SourceModules } from './source.ts';

export const DOSSIER_MODULES_SOURCE = join(homedir(), '.local', 'share', 'lanterne', 'modules-source');
export const DELAI_STABLE_MS = 300;
export const PERIODE_BALAYAGE_MS = 30_000;

export interface ParametresSurveillance {
  readonly dossier: string;
  readonly envoyer: (m: MessagePoste) => void;
  readonly journal: Logger;
  readonly delaiMs?: number;
  readonly periodeMs?: number;
}

export class SurveillanceModules {
  private readonly source: SourceModules;
  private readonly delaiMs: number;
  private readonly periodeMs: number;
  private veilleur: FSWatcher | null = null;
  private minuterie: ReturnType<typeof setTimeout> | null = null;
  private balayage: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly p: ParametresSurveillance) {
    this.source = new SourceModules({ dossier: p.dossier, envoyer: p.envoyer, journal: p.journal });
    this.delaiMs = p.delaiMs ?? DELAI_STABLE_MS;
    this.periodeMs = p.periodeMs ?? PERIODE_BALAYAGE_MS;
  }

  demarrer(): void {
    this.armer();
    this.synchroniser();
    this.balayage = setInterval(() => {
      this.armer();
      this.synchroniser();
    }, this.periodeMs);
  }

  arreter(): void {
    this.veilleur?.close();
    this.veilleur = null;
    if (this.minuterie !== null) clearTimeout(this.minuterie);
    this.minuterie = null;
    if (this.balayage !== null) clearInterval(this.balayage);
    this.balayage = null;
  }

  /** Envoie tout de suite ce qui a changé (sans attendre le délai). */
  synchroniser(): number {
    try {
      return this.source.synchroniser();
    } catch (erreur) {
      this.p.journal.error({ err: erreur, dossier: this.p.dossier }, 'synchronisation des modules échouée');
      return 0;
    }
  }

  // Chaque écriture repousse le passage : il n'a lieu que lorsque le dossier est resté calme `delaiMs`.
  private programmer(): void {
    if (this.minuterie !== null) clearTimeout(this.minuterie);
    this.minuterie = setTimeout(() => {
      this.minuterie = null;
      this.synchroniser();
    }, this.delaiMs);
  }

  private armer(): void {
    if (this.veilleur !== null || !existsSync(this.p.dossier)) return;
    try {
      const veilleur = watch(this.p.dossier, { recursive: true }, () => this.programmer());
      veilleur.on('error', (erreur) => {
        this.p.journal.warn({ err: erreur, dossier: this.p.dossier }, 'surveillance des modules interrompue');
        this.veilleur = null;
      });
      this.veilleur = veilleur;
    } catch (erreur) {
      this.p.journal.warn({ err: erreur, dossier: this.p.dossier }, 'surveillance impossible, balayage seul');
    }
  }
}
