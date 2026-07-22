// Horloge virtuelle : le temps n'avance que sur appel explicite à `avancer()`.
// Aucun `setTimeout`, aucune dépendance à la charge machine.

import type { AnnulerMinuterie, Horloge } from '../contrats/horloge.ts';

interface Minuterie {
  readonly id: number;
  readonly echeance: number;
  readonly action: () => void;
  annulee: boolean;
}

export class HorlogeSimulee implements Horloge {
  #instant = 0;
  #prochainId = 1;
  #minuteries: Minuterie[] = [];

  maintenant(): number {
    return this.#instant;
  }

  planifier(delaiMs: number, action: () => void): AnnulerMinuterie {
    const minuterie: Minuterie = {
      id: this.#prochainId++,
      echeance: this.#instant + Math.max(0, delaiMs),
      action,
      annulee: false,
    };
    this.#minuteries.push(minuterie);
    return () => {
      minuterie.annulee = true;
    };
  }

  attendre(delaiMs: number): Promise<void> {
    return new Promise((resoudre) => {
      this.planifier(delaiMs, resoudre);
    });
  }

  /** Avance le temps virtuel et déclenche les minuteries dues, dans l'ordre. */
  avancer(deltaMs: number): void {
    const cible = this.#instant + Math.max(0, deltaMs);
    for (let due = this.#prochaineDue(cible); due !== null; due = this.#prochaineDue(cible)) {
      this.#instant = due.echeance;
      due.annulee = true;
      due.action();
    }
    this.#instant = cible;
  }

  /** Avance jusqu'à un instant absolu. Sans effet si déjà passé. */
  avancerA(instant: number): void {
    this.avancer(instant - this.#instant);
  }

  /** Échéance de la prochaine minuterie active, `null` s'il n'y en a aucune. */
  prochaineEcheance(): number | null {
    let mini: number | null = null;
    for (const m of this.#minuteries) {
      if (m.annulee) continue;
      if (mini === null || m.echeance < mini) mini = m.echeance;
    }
    return mini;
  }

  /** Minuteries encore actives — utile pour prouver l'absence de fuite. */
  minuteriesEnAttente(): number {
    return this.#minuteries.filter((m) => !m.annulee).length;
  }

  /** Plus petite échéance due, `id` croissant en cas d'égalité — ordre total stable. */
  #prochaineDue(cible: number): Minuterie | null {
    let choisie: Minuterie | null = null;
    for (const m of this.#minuteries) {
      if (m.annulee || m.echeance > cible) continue;
      const meilleure =
        choisie === null ||
        m.echeance < choisie.echeance ||
        (m.echeance === choisie.echeance && m.id < choisie.id);
      if (meilleure) choisie = m;
    }
    return choisie;
  }
}
