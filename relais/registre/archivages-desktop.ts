// Responsabilité : les archivages repris de Claude Desktop, retenus en base — une conversation archivée dans Desktop
// est rangée une seule fois dans Lanterne ; si Chris la ressort ensuite, elle n'est plus jamais rangée d'office.
import type { Database } from 'bun:sqlite';

export interface MemoireArchivages {
  deja(conversation: string): boolean;
  retenir(conversation: string): void;
}

export class ArchivagesDesktop implements MemoireArchivages {
  constructor(private readonly db: Database) {
    db.exec('CREATE TABLE IF NOT EXISTS archivages_desktop (conversation TEXT PRIMARY KEY, le TEXT NOT NULL)');
  }

  deja(conversation: string): boolean {
    return this.db.query('SELECT 1 FROM archivages_desktop WHERE conversation = ?').get(conversation) !== null;
  }

  retenir(conversation: string): void {
    this.db
      .query('INSERT OR IGNORE INTO archivages_desktop (conversation, le) VALUES (?, ?)')
      .run(conversation, new Date().toISOString());
  }
}

/** Mémoire en processus seulement (essais, relais sans base) : même contrat. */
export class ArchivagesEnMemoire implements MemoireArchivages {
  private readonly vues = new Set<string>();

  deja(conversation: string): boolean {
    return this.vues.has(conversation);
  }

  retenir(conversation: string): void {
    this.vues.add(conversation);
  }
}
