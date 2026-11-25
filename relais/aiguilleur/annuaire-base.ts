// Responsabilité : la base de l'annuaire de l'aiguilleur — membres, jetons (empreintes), codes d'appairage, liens duo.
// Rien d'autre : ni session, ni événement, ni réglage. Migrations numérotées, jamais réécrites.
import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export const MIGRATIONS_ANNUAIRE: readonly string[] = [
  `CREATE TABLE membres (
     id TEXT PRIMARY KEY,
     genre TEXT NOT NULL CHECK (genre IN ('noeud', 'appareil')),
     nom TEXT NOT NULL,
     proprietaire TEXT NOT NULL,
     empreinte_cle TEXT NOT NULL,
     cree_le TEXT NOT NULL,
     revoque_le TEXT);
   CREATE TABLE jetons (
     empreinte TEXT PRIMARY KEY,
     membre TEXT NOT NULL REFERENCES membres(id) ON DELETE CASCADE,
     cree_le TEXT NOT NULL);
   CREATE TABLE appairages (
     empreinte TEXT PRIMARY KEY,
     proprietaire TEXT NOT NULL,
     cree_le TEXT NOT NULL,
     expire_le TEXT NOT NULL);
   CREATE TABLE liens_duo (
     a TEXT NOT NULL,
     b TEXT NOT NULL,
     cree_le TEXT NOT NULL,
     PRIMARY KEY (a, b),
     CHECK (a < b));`,
  `ALTER TABLE appairages ADD COLUMN portee TEXT NOT NULL DEFAULT 'meme_proprietaire'
     CHECK (portee IN ('meme_proprietaire', 'invitation_duo'));
   ALTER TABLE appairages ADD COLUMN nom_invite TEXT;`,
  `ALTER TABLE membres ADD COLUMN sans_ecran INTEGER NOT NULL DEFAULT 0;`,
];

/** Ouvre (et migre) l'annuaire. `:memory:` pour les essais. */
export function ouvrirAnnuaire(chemin: string): Database {
  if (chemin !== ':memory:') mkdirSync(dirname(chemin), { recursive: true });
  const db = new Database(chemin, { create: true, strict: true });
  db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;');
  const version = db.query<{ user_version: number }, []>('PRAGMA user_version').get()?.user_version ?? 0;
  for (let i = version; i < MIGRATIONS_ANNUAIRE.length; i++) {
    db.transaction(() => {
      db.exec(MIGRATIONS_ANNUAIRE[i] ?? '');
      db.exec(`PRAGMA user_version = ${i + 1}`);
    })();
  }
  return db;
}
