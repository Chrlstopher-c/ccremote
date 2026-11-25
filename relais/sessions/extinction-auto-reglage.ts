// Responsabilité : le réglage de l'extinction automatique des sessions, tenu par le nœud (une seule ligne en base).
// `null` = jamais (défaut) : le nœud n'éteint alors aucune session d'office.
import type { Database } from 'bun:sqlite';

export class ReglageExtinctionAuto {
  constructor(private readonly db: Database) {
    db.exec(
      'CREATE TABLE IF NOT EXISTS extinction_auto (' +
        'id INTEGER PRIMARY KEY CHECK (id = 1), delai_minutes INTEGER, maj_le TEXT NOT NULL)',
    );
  }

  delai(): number | null {
    const ligne = this.db
      .query<{ delai: number | null }, []>('SELECT delai_minutes AS delai FROM extinction_auto WHERE id = 1')
      .get();
    return ligne?.delai ?? null;
  }

  definir(delai: number | null): number | null {
    this.db
      .query(
        `INSERT INTO extinction_auto (id, delai_minutes, maj_le) VALUES (1, $delai, $le)
         ON CONFLICT(id) DO UPDATE SET delai_minutes = excluded.delai_minutes, maj_le = excluded.maj_le`,
      )
      .run({ delai, le: new Date().toISOString() });
    return delai;
  }
}
