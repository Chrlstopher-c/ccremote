/**
 * Responsabilité : SEULE trace de « quand l'orchestrateur a regardé le
 * carburant du parc pour la dernière fois » (garde 2 — dispatcher sans
 * regarder le carburant). Une ligne unique, jamais un flux à agréger — voir
 * migration 31.
 */

import type { Database } from 'bun:sqlite';
import { executer } from './journal.ts';

interface LigneObservationParc {
  carburant_consulte_a: number | null;
}

export class DepotObservationParc {
  private readonly db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  /** `null` : jamais consulté depuis l'origine du registre. */
  public carburantConsulteA(): number | null {
    return executer('observationParc.carburantConsulteA', () => {
      const ligne = this.db
        .query<LigneObservationParc, []>('SELECT carburant_consulte_a FROM observation_parc WHERE id = 1')
        .get();
      return ligne?.carburant_consulte_a ?? null;
    });
  }

  /** Appelé par `carburant_parc` (A.2.2) à chaque consultation réelle. */
  public enregistrerConsultationCarburant(maintenant: number): void {
    executer(
      'observationParc.enregistrerConsultationCarburant',
      () => {
        this.db.query('UPDATE observation_parc SET carburant_consulte_a = ? WHERE id = 1').run(maintenant);
      },
      { maintenant },
    );
  }
}
