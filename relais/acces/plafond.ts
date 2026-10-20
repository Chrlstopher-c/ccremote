// Responsabilité : le plafond global d'échecs de connexion, toutes IP confondues, conservé sur disque (survit aux
// redémarrages) — la limite par IP seule ne freine pas une attaque répartie.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Logger } from 'pino';

export const FENETRE_GLOBALE_MS = 60 * 60 * 1000;
export const MAX_ECHECS_GLOBAL = 20;

export class PlafondEchecs {
  private echecs: number[];

  constructor(
    private readonly fichier: string,
    private readonly journal: Logger,
    private readonly maintenant: () => number = Date.now,
  ) {
    this.echecs = this.lire();
  }

  atteint(): boolean {
    this.purger();
    return this.echecs.length >= MAX_ECHECS_GLOBAL;
  }

  noter(): void {
    this.purger();
    this.echecs.push(this.maintenant());
    if (this.echecs.length === MAX_ECHECS_GLOBAL)
      this.journal.warn('plafond global d’échecs atteint : connexions suspendues');
    this.ecrire();
  }

  private purger(): void {
    const limite = this.maintenant() - FENETRE_GLOBALE_MS;
    this.echecs = this.echecs.filter((t) => t > limite);
  }

  private lire(): number[] {
    if (!existsSync(this.fichier)) return [];
    try {
      const v: unknown = JSON.parse(readFileSync(this.fichier, 'utf8'));
      return Array.isArray(v) ? v.filter((t): t is number => typeof t === 'number') : [];
    } catch (e) {
      // Fichier illisible : on part plein plutôt que vide, pour ne pas offrir une remise à zéro à l'attaquant.
      this.journal.error({ err: e, fichier: this.fichier }, 'échecs de connexion illisibles : plafond appliqué');
      return Array.from({ length: MAX_ECHECS_GLOBAL }, () => this.maintenant());
    }
  }

  private ecrire(): void {
    try {
      mkdirSync(dirname(this.fichier), { recursive: true });
      const provisoire = `${this.fichier}.tmp`;
      writeFileSync(provisoire, JSON.stringify(this.echecs), { mode: 0o600 });
      renameSync(provisoire, this.fichier);
    } catch (e) {
      this.journal.error({ err: e, fichier: this.fichier }, 'échecs de connexion non enregistrés');
    }
  }
}
