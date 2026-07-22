/**
 * Responsabilité : un canal de données unidirectionnel (`Tuyau`) au-dessus
 * d'une trame — garantit l'ordre et l'intégrité (D.1.3), survit à une coupure
 * en rejouant ce qui n'a pas été acquitté (D.2 : c'est le fondement de zéro
 * octet perdu ni dupliqué au rattachement).
 *
 * `☠ CASSE` — un trou de séquence en mode `strict` doit échouer bruyamment
 * (`ErreurIntegriteTuyau`), jamais être absorbé silencieusement : c'est la
 * panne #27 de la grille de revue, celle qui ressemble à un bug du SDK.
 */

import { ErreurIntegriteTuyau, type ModeIntegrite, type Tuyau } from './contrat.ts';

export interface DepsCanalDonnees {
  readonly nom: string;
  readonly modeIntegrite: ModeIntegrite;
  /** Émission réelle vers la connexion physique. Appelée aussi pour le rejeu. */
  readonly envoyer: (seq: number, payload: Uint8Array) => void;
}

export class CanalDonnees implements Tuyau {
  #seqEnvoi = 0;
  #seqAttendu = 0;
  #emis = 0;
  #recus = 0;
  readonly #abonnes: Array<(octets: Uint8Array) => void> = [];
  readonly #nonAcquittes = new Map<number, Uint8Array>();

  constructor(private readonly deps: DepsCanalDonnees) {}

  /** Écriture locale : bufferisée pour rejeu, puis émise si la connexion est vivante. */
  ecrire(octets: Uint8Array): void {
    const seq = this.#seqEnvoi;
    this.#seqEnvoi += 1;
    this.#nonAcquittes.set(seq, octets);
    this.#emis += octets.length;
    this.deps.envoyer(seq, octets);
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

  /** Dernier numéro de séquence livré sans trou — base de l'accusé de réception. */
  dernierRecuContigu(): number {
    return this.#seqAttendu - 1;
  }

  /**
   * Réception d'une trame de ce canal. Idempotent : une séquence déjà livrée
   * (rejeu après rattachement, D.2.2) est silencieusement ignorée, jamais
   * redélivrée aux abonnés — c'est ce qui garantit « zéro octet dupliqué ».
   */
  recevoir(seq: number, payload: Uint8Array): void {
    if (seq < this.#seqAttendu) return;
    if (seq > this.#seqAttendu) {
      if (this.deps.modeIntegrite === 'strict') {
        throw new ErreurIntegriteTuyau(this.#seqAttendu, seq);
      }
      this.#seqAttendu = seq;
    }
    this.#seqAttendu = seq + 1;
    this.#recus += payload.length;
    for (const abonne of this.#abonnes) abonne(payload);
  }

  /** Purge le tampon de rejeu jusqu'à `seqAcquittee` inclus (ACK reçu de l'autre bout). */
  acquitterJusque(seqAcquittee: number): void {
    for (const seq of [...this.#nonAcquittes.keys()]) {
      if (seq <= seqAcquittee) this.#nonAcquittes.delete(seq);
    }
  }

  /** Nombre d'octets en attente d'un accusé de réception — jamais perdus, à rejouer. */
  octetsNonAcquittes(): number {
    let total = 0;
    for (const payload of this.#nonAcquittes.values()) total += payload.length;
    return total;
  }

  /** Rejoue, dans l'ordre des séquences, tout ce qui n'a pas été acquitté (rattachement). */
  rejouerNonAcquitte(): void {
    const seqs = [...this.#nonAcquittes.keys()].sort((a, b) => a - b);
    for (const seq of seqs) this.deps.envoyer(seq, this.#nonAcquittes.get(seq)!);
  }
}
