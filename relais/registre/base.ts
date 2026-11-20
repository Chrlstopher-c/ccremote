// Responsabilité : la base SQLite du relais et ses migrations (numérotées, jamais réécrites).
import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

// Numérotées : une migration déjà appliquée (user_version) n'est jamais réécrite. Exportées pour les tests.
export const MIGRATIONS: readonly string[] = [
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
   CREATE TABLE jetons (
     empreinte TEXT PRIMARY KEY, cree_le TEXT NOT NULL, expire_le TEXT NOT NULL, appareil TEXT NOT NULL);`,
  `ALTER TABLE machines ADD COLUMN etat_comptes TEXT NOT NULL DEFAULT '[]';`,
  `ALTER TABLE jetons ADD COLUMN genre TEXT NOT NULL DEFAULT 'appareil';
   ALTER TABLE jetons ADD COLUMN vu_le TEXT;
   UPDATE jetons SET genre = 'claude-code' WHERE appareil LIKE 'mcp-%';`,
  `ALTER TABLE sessions ADD COLUMN archivee INTEGER NOT NULL DEFAULT 0;`,
  `CREATE TABLE reunions (
     id TEXT PRIMARY KEY, sujet TEXT NOT NULL, cree_le TEXT NOT NULL, participants TEXT NOT NULL DEFAULT '[]');
   CREATE TABLE reunion_messages (
     seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE,
     reunion_id TEXT NOT NULL REFERENCES reunions(id) ON DELETE CASCADE,
     auteur TEXT NOT NULL, texte TEXT NOT NULL, ts TEXT NOT NULL, destinataires TEXT NOT NULL DEFAULT '[]');
   CREATE INDEX reunion_messages_reunion ON reunion_messages(reunion_id, seq);`,
  `ALTER TABLE sessions ADD COLUMN epinglee INTEGER NOT NULL DEFAULT 0;`,
  `CREATE TABLE environnements (
     machine TEXT NOT NULL, dossier TEXT NOT NULL, enregistre_le TEXT NOT NULL, PRIMARY KEY (machine, dossier));`,
  `CREATE TABLE machines_ssh (
     id TEXT PRIMARY KEY, description TEXT NOT NULL DEFAULT '', hote TEXT NOT NULL, port INTEGER NOT NULL DEFAULT 22,
     utilisateur TEXT NOT NULL, cle TEXT NOT NULL, dossier TEXT NOT NULL DEFAULT '~',
     cree_le TEXT NOT NULL, maj_le TEXT NOT NULL);`,
  `ALTER TABLE sessions ADD COLUMN non_lue INTEGER NOT NULL DEFAULT 0;`,
  // Port d'écoute du tunnel inverse sur la machine distante (défaut de l'instance banc : voir le relais).
  `ALTER TABLE machines_ssh ADD COLUMN port_distant INTEGER NOT NULL DEFAULT 47321;`,
  // Catégories de la barre latérale : un seul document (JSON), remplacé d'un bloc.
  `CREATE TABLE categories (id INTEGER PRIMARY KEY CHECK (id = 1), document TEXT NOT NULL, maj_le TEXT NOT NULL);`,
  // Groupes masqués de la barre latérale : même forme que les catégories, un seul document.
  `CREATE TABLE groupes_masques (id INTEGER PRIMARY KEY CHECK (id = 1), document TEXT NOT NULL, maj_le TEXT NOT NULL);`,
  // Modules (Quart) : un enregistrement par identifiant, le plus récent gagne ; `erreur` non nul = module refusé.
  `CREATE TABLE modules (
     id TEXT PRIMARY KEY, machine TEXT NOT NULL, manifeste TEXT, fichiers TEXT NOT NULL DEFAULT '[]',
     empreinte TEXT, maj_le TEXT NOT NULL, erreur TEXT);`,
  // Toujours ajouter à la fin : l'ordre est la version de la base (PRAGMA user_version).
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
