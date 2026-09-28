// Responsabilité : la base SQLite du relais et ses migrations (numérotées, jamais réécrites).
import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const MIGRATIONS: readonly string[] = [
  `CREATE TABLE machines (
     id TEXT PRIMARY KEY, description TEXT NOT NULL DEFAULT '', racines TEXT NOT NULL DEFAULT '[]',
     projets TEXT NOT NULL DEFAULT '[]', comptes TEXT NOT NULL DEFAULT '[]', version TEXT NOT NULL DEFAULT '',
     etat TEXT, derniere_vue TEXT NOT NULL);
   CREATE TABLE sessions (id TEXT PRIMARY KEY, machine TEXT NOT NULL, resume TEXT NOT NULL, maj_le TEXT NOT NULL);
   CREATE TABLE evenements (
     seq INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL, ts TEXT NOT NULL, evt TEXT NOT NULL);
   CREATE INDEX evenements_session ON evenements(session_id, seq);
   CREATE TABLE notifications (
     seq INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT, niveau TEXT NOT NULL, titre TEXT NOT NULL,
     texte TEXT NOT NULL, ts TEXT NOT NULL, lue INTEGER NOT NULL DEFAULT 0);
   CREATE TABLE jetons (empreinte TEXT PRIMARY KEY, cree_le TEXT NOT NULL, expire_le TEXT NOT NULL, appareil TEXT NOT NULL);`,
];

export function ouvrirBase(chemin: string): Database {
  if (chemin !== ':memory:') mkdirSync(dirname(chemin), { recursive: true });
  const db = new Database(chemin, { create: true, strict: true });
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  migrer(db);
  return db;
}

function migrer(db: Database): void {
  const { user_version: version } = db.query('PRAGMA user_version').get() as { user_version: number };
  for (let i = version; i < MIGRATIONS.length; i++) {
    db.transaction(() => {
      db.exec(MIGRATIONS[i] as string);
      db.exec(`PRAGMA user_version = ${i + 1}`);
    })();
  }
}
