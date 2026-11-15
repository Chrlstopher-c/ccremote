// Responsabilité : l'arborescence fictive de la démo — un petit projet sans aucun chemin réel. Données seules :
// le service de fichiers en fait une copie modifiable, le faux shell la lit telle quelle.

export interface NoeudDemo {
  readonly chemin: string;
  /** Contenu d'un fichier texte ; null pour un dossier. */
  readonly contenu: string | null;
}

export const RACINE_DEMO = '/demo';
export const PROJET_DEMO = '/demo/agent-hq';
export const DATE_DEMO = '2026-11-15T09:00:00.000Z';

export const ARBRE_DEMO: readonly NoeudDemo[] = [
  { chemin: '/', contenu: null },
  { chemin: RACINE_DEMO, contenu: null },
  { chemin: PROJET_DEMO, contenu: null },
  { chemin: `${PROJET_DEMO}/README.md`, contenu: '# agent-hq\n\nSurface de pilotage du poste et du parc.\n' },
  { chemin: `${PROJET_DEMO}/package.json`, contenu: '{\n  "name": "agent-hq",\n  "private": true\n}\n' },
  { chemin: `${PROJET_DEMO}/.env.example`, contenu: 'VITE_SOURCE=demo\nVITE_RELAIS_URL=\n' },
  { chemin: `${PROJET_DEMO}/TODO.md`, contenu: '# TODO\n\n- Terminal relié à une session tmux\n' },
  { chemin: `${PROJET_DEMO}/docs`, contenu: null },
  {
    chemin: `${PROJET_DEMO}/docs/ARCHITECTURE.md`,
    contenu: '# Architecture\n\nLe monde lit la source, rien d’autre.\n',
  },
  { chemin: `${PROJET_DEMO}/src`, contenu: null },
  { chemin: `${PROJET_DEMO}/src/donnees`, contenu: null },
  { chemin: `${PROJET_DEMO}/src/donnees/index.ts`, contenu: "export type * from './contrat';\n" },
  {
    chemin: `${PROJET_DEMO}/src/donnees/monde-etat.ts`,
    contenu: '// Magasin observable de l’état du monde.\nexport class MagasinMonde {}\n',
  },
  { chemin: `${PROJET_DEMO}/src/main.ts`, contenu: "import { demarrer } from './app';\n\ndemarrer();\n" },
];
