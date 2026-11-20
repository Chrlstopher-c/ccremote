// Responsabilité : le dernier réseau connu de chaque machine (MAC, diffusion) pour le réveil, dans `reveil.json` des
// données du relais (0600). Données locales : jamais dans le dépôt, jamais montrées telles quelles aux clients.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Logger } from 'pino';
import { z } from 'zod';

const Reseaux = z.record(z.string(), z.object({ mac: z.string(), diffusion: z.string() }));
export interface ReseauConnu {
  readonly mac: string;
  readonly diffusion: string;
}

export class ReseauxConnus {
  private reseaux: Readonly<Record<string, ReseauConnu>>;

  constructor(
    private readonly chemin: string,
    private readonly journal: Logger,
  ) {
    this.reseaux = this.lire();
  }

  /** Retient le réseau d'une machine ; n'écrit que si quelque chose a changé. */
  retenir(id: string, reseau: ReseauConnu): void {
    const actuel = this.reseaux[id];
    if (actuel?.mac === reseau.mac && actuel.diffusion === reseau.diffusion) return;
    this.reseaux = { ...this.reseaux, [id]: { mac: reseau.mac, diffusion: reseau.diffusion } };
    this.ecrire();
  }

  de(id: string): ReseauConnu | null {
    return this.reseaux[id] ?? null;
  }

  ids(): string[] {
    return Object.keys(this.reseaux);
  }

  private lire(): Record<string, ReseauConnu> {
    try {
      return Reseaux.parse(JSON.parse(readFileSync(this.chemin, 'utf8')));
    } catch (erreur) {
      if ((erreur as NodeJS.ErrnoException).code !== 'ENOENT')
        this.journal.warn({ err: erreur }, 'réseaux des machines illisibles');
      return {};
    }
  }

  private ecrire(): void {
    const temporaire = `${this.chemin}.tmp`;
    try {
      mkdirSync(dirname(this.chemin), { recursive: true, mode: 0o700 });
      writeFileSync(temporaire, JSON.stringify(this.reseaux), { mode: 0o600 });
      renameSync(temporaire, this.chemin);
    } catch (erreur) {
      this.journal.warn({ err: erreur }, 'réseaux des machines non écrits');
    }
  }
}
