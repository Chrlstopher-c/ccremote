/**
 * Responsabilité : capacités annoncées par `SDKSystemMessage.capabilities` (E.5).
 * « Lire, ne pas supposer. » Un parc hétérogène est possible : un worker sur un
 * binaire ancien n'offre pas les mêmes garanties, et l'UI doit le montrer plutôt
 * que de laisser croire à une panne.
 */

import type { Database } from 'bun:sqlite';
import { executer } from './journal.ts';
import { versCapacite, type LigneCapacite } from './lignes.ts';
import type { Capacite } from './types.ts';

/** Capacités dont l'absence a une conséquence documentée (E.5). */
export const CAPACITES_SURVEILLEES = [
  'interrupt_receipt_v1',
  'can_use_tool_request_id',
  'reinitialize',
  'parent_agent_id',
] as const;

export class DepotCapacites {
  private readonly db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  /** Enregistre l'inventaire complet observé au démarrage d'un worker. */
  public enregistrer(
    missionId: string,
    capacites: Readonly<Record<string, boolean>>,
    maintenant: number = Date.now(),
  ): readonly Capacite[] {
    return executer(
      'capacites.enregistrer',
      () => {
        const requete = this.db.query(
          `INSERT INTO capacite_mission (mission_id, capacite, presente, observe_a)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(mission_id, capacite) DO UPDATE SET
             presente = excluded.presente,
             observe_a = excluded.observe_a`,
        );
        this.db.transaction(() => {
          for (const [capacite, presente] of Object.entries(capacites)) {
            requete.run(missionId, capacite, presente ? 1 : 0, maintenant);
          }
        })();
        return this.lister(missionId);
      },
      { missionId },
    );
  }

  public lister(missionId: string): readonly Capacite[] {
    return executer(
      'capacites.lister',
      () => {
        const lignes = this.db
          .query<LigneCapacite, [string]>(
            'SELECT * FROM capacite_mission WHERE mission_id = ? ORDER BY capacite',
          )
          .all(missionId);
        return lignes.map(versCapacite);
      },
      { missionId },
    );
  }

  /** `null` = jamais observée, à distinguer de « observée absente ». */
  public estPresente(missionId: string, capacite: string): boolean | null {
    return executer(
      'capacites.estPresente',
      () => {
        const ligne = this.db
          .query<LigneCapacite, [string, string]>(
            'SELECT * FROM capacite_mission WHERE mission_id = ? AND capacite = ?',
          )
          .get(missionId, capacite);
        if (!ligne) return null;
        return ligne.presente === 1;
      },
      { missionId, capacite },
    );
  }

  /** Capacités surveillées observées absentes — ce que l'UI doit signaler. */
  public manquantesSurveillees(missionId: string): readonly string[] {
    return CAPACITES_SURVEILLEES.filter((c) => this.estPresente(missionId, c) === false);
  }
}
