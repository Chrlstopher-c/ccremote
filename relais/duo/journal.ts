// Responsabilité : le journal du mode duo, chez le propriétaire — une ligne par action du pair (ouvrir, écrire,
// interrompre). Une écriture qui échoue est journalisée au relais, sans rien casser de l'action.
import type { Database } from 'bun:sqlite';
import type { Logger } from 'pino';
import type { EntreeJournal } from '../../commun/duo.ts';

export type NouvelleEntree = Omit<EntreeJournal, 'id'>;

export class JournalDuo {
  constructor(
    private readonly base: Database,
    private readonly journal: Logger,
  ) {
    base.exec(`CREATE TABLE IF NOT EXISTS duo_journal (
      id INTEGER PRIMARY KEY AUTOINCREMENT, le TEXT NOT NULL, qui TEXT NOT NULL, action TEXT NOT NULL,
      cible TEXT NOT NULL, detail TEXT NOT NULL)`);
  }

  ecrire(entree: NouvelleEntree): void {
    try {
      this.base
        .query('INSERT INTO duo_journal (le, qui, action, cible, detail) VALUES ($le, $qui, $action, $cible, $detail)')
        .run({ le: entree.le, qui: entree.qui, action: entree.action, cible: entree.cible, detail: entree.detail });
    } catch (erreur) {
      this.journal.error({ err: erreur, action: entree.action }, 'action du pair non journalisée');
    }
  }

  lister(limite = 200): EntreeJournal[] {
    return this.base
      .query('SELECT id, le, qui, action, cible, detail FROM duo_journal ORDER BY id DESC LIMIT $n')
      .all({ n: limite }) as EntreeJournal[];
  }
}
