/**
 * Interface publique du module `session-store` (branche E.3, mission M-31).
 * Aucun autre module ne doit importer les fichiers internes de ce dossier.
 *
 * Périmètre : l'adaptateur `SessionStore` réel (SQLite, H-21) et son observabilité de
 * divergence. Le registre des missions (E.1, M-03) est un module séparé — voir
 * `control-plane/registre/`. Les deux ne partagent ni schéma ni connexion.
 */

import { fermerBaseStore, ouvrirBaseStore, type OptionsConnexionStore } from './connexion.ts';
import { SessionStoreSqlite, type Horloge } from './adaptateur.ts';
import { VERSION_SCHEMA_STORE_CIBLE, versionSchemaStore } from './migrations.ts';
import type { Database } from 'bun:sqlite';

export { SessionStoreSqlite } from './adaptateur.ts';
export type { EtatMiroir, Horloge } from './adaptateur.ts';
export type { Defaillance } from './defaillances.ts';
export type { OptionsConnexionStore } from './connexion.ts';
export { VERSION_SCHEMA_STORE_CIBLE } from './migrations.ts';
export { ErreurSessionStore } from './journal.ts';

/**
 * Point d'entrée unique : ouvre (et migre si nécessaire) la base, retourne l'adaptateur
 * prêt à être passé en `Options.sessionStore` lors du spawn d'un worker (B, `WorkerSpec`).
 */
export function ouvrirSessionStore(
  options: OptionsConnexionStore,
  horloge?: Horloge,
): { store: SessionStoreSqlite; fermer: () => void; version: () => number; db: Database } {
  const db = ouvrirBaseStore(options);
  const store = horloge ? new SessionStoreSqlite(db, horloge) : new SessionStoreSqlite(db);
  return {
    store,
    fermer: () => fermerBaseStore(db),
    version: () => versionSchemaStore(db),
    db,
  };
}

export const VERSION_SCHEMA_ATTENDUE = VERSION_SCHEMA_STORE_CIBLE;
