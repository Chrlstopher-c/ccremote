// Générateur pseudo-aléatoire semé (mulberry32).
// Même graine ⇒ même suite. C'est ce qui rend reproductibles les pannes
// qui ont besoin d'un motif « aléatoire » (perte d'octets sous charge, #27).

import type { Alea } from '../contrats/horloge.ts';

export class AleaSeme implements Alea {
  #etat: number;

  constructor(graine: number) {
    this.#etat = graine >>> 0;
  }

  suivant(): number {
    this.#etat = (this.#etat + 0x6d2b79f5) >>> 0;
    let t = this.#etat;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  entier(borneExclue: number): number {
    if (borneExclue <= 0) return 0;
    return Math.floor(this.suivant() * borneExclue);
  }

  tirage(probabilite: number): boolean {
    return this.suivant() < probabilite;
  }
}
