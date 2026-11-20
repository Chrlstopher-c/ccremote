// Responsabilité : la version du code (poste, relais, moteur) et son commit — posé à la compilation du moteur
// (QUART_COMMIT), sinon lu du fichier COMMIT de l'archive du poste.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { creerJournal } from './journal.ts';

export const VERSION = '2.0.0';

/** Le commit : la valeur compilée prime, sinon celle du fichier ; null si aucune des deux n'existe. */
export function commitDe(compile: string | undefined, fichier: string | null): string | null {
  return (compile ?? fichier ?? '').trim() || null;
}

function lireFichierCommit(chemin: string): string | null {
  try {
    return readFileSync(chemin, 'utf8');
  } catch (erreur) {
    if ((erreur as NodeJS.ErrnoException).code !== 'ENOENT') {
      creerJournal('version').warn({ err: erreur }, 'fichier COMMIT illisible');
    }
    return null;
  }
}

// `process.env.QUART_COMMIT` (notation pointée) : c'est elle que `bun build --define` remplace à la compilation.
export const COMMIT: string | null = commitDe(
  process.env.QUART_COMMIT,
  lireFichierCommit(join(import.meta.dir, '..', 'COMMIT')),
);
