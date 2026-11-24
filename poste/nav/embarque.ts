// Responsabilité : les sources de la CLI `noctis-nav`, embarquées dans le binaire compilé (pas sur disque).
// Le poste les extrait dans son dossier de données au démarrage (poste/nav/extraction.ts). Chaque source est un fichier
// embarqué (`type: 'file'`) lu à l'exécution ; le binaire ne l'importe pas comme module, Bun ne sait pas faire les deux
// pour un même fichier. Les `@ts-expect-error` : TypeScript ne connaît pas le type de ces `.mjs`.
import { readFileSync } from 'node:fs';
// @ts-expect-error source embarquée, voir l'en-tête
import clientChemin from './client.mjs' with { type: 'file' };
// @ts-expect-error source embarquée, voir l'en-tête
import cliChemin from './cli.mjs' with { type: 'file' };
// @ts-expect-error source embarquée, voir l'en-tête
import entreeChemin from './entree.mjs' with { type: 'file' };

const CHEMINS: Readonly<Record<string, string>> = {
  'client.mjs': clientChemin,
  'cli.mjs': cliChemin,
  'entree.mjs': entreeChemin,
};

export const SOURCES_NAV: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(CHEMINS).map(([nom, chemin]) => [nom, readFileSync(chemin, 'utf8')]),
);
