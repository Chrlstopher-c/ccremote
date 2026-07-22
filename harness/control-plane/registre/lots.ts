/**
 * Responsabilité : accès aux lots (F2.1.4).
 * Un lot = l'ensemble des missions issues d'une même intention utilisateur.
 * En v1 il n'en porte qu'une (H-56) ; la table existe pour le parallélisme futur.
 */

import type { Database } from 'bun:sqlite';
import { executer } from './journal.ts';
import { versLot, type LigneLot } from './lignes.ts';
import type { CreationLot, Lot } from './types.ts';

export class DepotLots {
  private readonly db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  public creer(creation: CreationLot, maintenant: number = Date.now()): Lot {
    return executer(
      'lots.creer',
      () => {
        this.db
          .query('INSERT INTO lot (id, intention, origine, cree_a, clos_a) VALUES (?, ?, ?, ?, NULL)')
          .run(creation.id, creation.intention, creation.origine ?? null, maintenant);
        return {
          id: creation.id,
          intention: creation.intention,
          origine: creation.origine ?? null,
          creeA: maintenant,
          closA: null,
        };
      },
      { id: creation.id },
    );
  }

  public lire(id: string): Lot | null {
    return executer(
      'lots.lire',
      () => {
        const ligne = this.db.query<LigneLot, [string]>('SELECT * FROM lot WHERE id = ?').get(id);
        return ligne ? versLot(ligne) : null;
      },
      { id },
    );
  }

  public clore(id: string, maintenant: number = Date.now()): boolean {
    return executer(
      'lots.clore',
      () => {
        const res = this.db
          .query('UPDATE lot SET clos_a = ? WHERE id = ? AND clos_a IS NULL')
          .run(maintenant, id);
        return res.changes > 0;
      },
      { id },
    );
  }

  /** Lots les plus récents d'abord — répond à « ce que j'ai demandé hier soir ». */
  public listerRecents(limite: number = 50): readonly Lot[] {
    return executer(
      'lots.listerRecents',
      () => {
        const lignes = this.db
          .query<LigneLot, [number]>('SELECT * FROM lot ORDER BY cree_a DESC LIMIT ?')
          .all(limite);
        return lignes.map(versLot);
      },
      { limite },
    );
  }

  public listerOuverts(): readonly Lot[] {
    return executer('lots.listerOuverts', () => {
      const lignes = this.db
        .query<LigneLot, []>('SELECT * FROM lot WHERE clos_a IS NULL ORDER BY cree_a DESC')
        .all();
      return lignes.map(versLot);
    });
  }
}
