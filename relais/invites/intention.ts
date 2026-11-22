// Responsabilité : les intentions d'invitation pour une machine pas encore reliée — « inviter » demande l'appairage,
// et à l'admission le membre entre invité (et non pair avec tous les droits). Mémoire + fichier 600, expire.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Logger } from 'pino';
import { z } from 'zod';
import { ReglagesInvite } from '../../commun/invites.ts';

const Fichier = z.object({
  intentions: z.record(z.string(), z.object({ reglages: ReglagesInvite, expire: z.number() })),
});
type Entree = { readonly reglages: ReglagesInvite; readonly expire: number };

export class Intentions {
  private liste: Record<string, Entree>;

  constructor(
    private readonly chemin: string,
    private readonly journal: Logger,
    private readonly maintenant: () => number = Date.now,
  ) {
    this.liste = this.lire();
  }

  pose(membre: string, reglages: ReglagesInvite, dureeMs: number): void {
    this.liste = { ...this.liste, [membre]: { reglages, expire: this.maintenant() + dureeMs } };
    this.ecrire();
  }

  /** L'intention d'un membre, si elle n'a pas expiré ; elle est consommée (une seule admission). */
  prendre(membre: string): ReglagesInvite | null {
    const entree = this.liste[membre];
    if (entree === undefined) return null;
    const { [membre]: _retiree, ...restantes } = this.liste;
    this.liste = restantes;
    this.ecrire();
    return entree.expire > this.maintenant() ? entree.reglages : null;
  }

  private lire(): Record<string, Entree> {
    try {
      const lu = Fichier.safeParse(JSON.parse(readFileSync(this.chemin, 'utf8')));
      return lu.success ? lu.data.intentions : {};
    } catch {
      return {};
    }
  }

  private ecrire(): void {
    try {
      mkdirSync(dirname(this.chemin), { recursive: true, mode: 0o700 });
      const tmp = `${this.chemin}.tmp`;
      writeFileSync(tmp, JSON.stringify({ intentions: this.liste }), { mode: 0o600 });
      renameSync(tmp, this.chemin);
    } catch (erreur) {
      this.journal.error({ err: erreur }, 'intentions d’invitation non écrites');
    }
  }
}
