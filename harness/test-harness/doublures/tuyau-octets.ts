// Doublure de canal d'octets. Aucune ressource réelle : pas de socket, pas de
// processus, pas de fichier. Tout est en mémoire et synchrone ⇒ déterministe.

import type { ModeIntegrite, Tuyau } from '../contrats/transport.ts';
import { ErreurIntegriteTuyau } from '../contrats/transport.ts';
import type { JournalPannes } from '../journal/journal-pannes.ts';

export interface OptionsTuyau {
  readonly nom: string;
  readonly mode: ModeIntegrite;
}

export class TuyauOctets implements Tuyau {
  #emis = 0;
  #recus = 0;
  #suspendu = false;
  #perteProgrammee = 0;
  #retenus: Uint8Array[] = [];
  #abonnes: ((octets: Uint8Array) => void)[] = [];

  constructor(
    private readonly options: OptionsTuyau,
    private readonly journal: JournalPannes,
  ) {}

  ecrire(octets: Uint8Array): void {
    this.#emis += octets.length;
    if (this.#suspendu) {
      this.#retenus.push(octets);
      return;
    }
    this.#remettre(octets);
  }

  surOctets(abonne: (octets: Uint8Array) => void): void {
    this.#abonnes.push(abonne);
  }

  octetsEmis(): number {
    return this.#emis;
  }

  octetsRecus(): number {
    return this.#recus;
  }

  /** Coupure transitoire : on retient, on ne perd pas, on ne remonte rien. */
  suspendre(): void {
    this.#suspendu = true;
  }

  /** Rétablissement : rejeu des octets retenus, dans l'ordre. */
  reprendre(): void {
    this.#suspendu = false;
    const retenus = this.#retenus;
    this.#retenus = [];
    for (const paquet of retenus) this.#remettre(paquet);
  }

  /** Programme la perte des `nbOctets` prochains octets remis (panne #27). */
  injecterPerte(nbOctets: number): void {
    this.#perteProgrammee += Math.max(0, nbOctets);
  }

  octetsRetenus(): number {
    return this.#retenus.reduce((total, p) => total + p.length, 0);
  }

  #remettre(octets: Uint8Array): void {
    const utiles = this.#appliquerPerte(octets);
    this.#recus += utiles.length;
    for (const abonne of this.#abonnes) abonne(utiles);
  }

  /** Retire les octets programmés. En mode `strict`, échoue bruyamment. */
  #appliquerPerte(octets: Uint8Array): Uint8Array {
    if (this.#perteProgrammee === 0) return octets;
    const perdus = Math.min(this.#perteProgrammee, octets.length);
    this.#perteProgrammee -= perdus;
    this.journal.enregistrer('octets_perdus', { tuyau: this.options.nom, perdus });
    if (this.options.mode === 'strict') {
      this.journal.enregistrer('integrite_rompue', { tuyau: this.options.nom, perdus });
      throw new ErreurIntegriteTuyau(this.#emis, this.#recus + octets.length - perdus);
    }
    return octets.subarray(0, octets.length - perdus);
  }
}
