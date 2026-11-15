// Responsabilité : l'interpréteur du faux shell de la démo — une ligne de commande et le dossier courant en entrée, la
// sortie et le nouveau dossier en sortie. Pur : aucune horloge, aucun réseau, données de arbre-demo.
import { ARBRE_DEMO, PROJET_DEMO } from './arbre-demo';
import { enfantsDe, estDans, nomDe, resoudreChemin } from './chemins';

export interface ResultatCommande {
  readonly sortie: string;
  readonly cwd: string;
  readonly effacer: boolean;
}

interface ResultatBrut {
  readonly sortie: string;
  readonly cwd?: string;
  readonly effacer?: boolean;
}

type Gestionnaire = (args: readonly string[], cwd: string) => ResultatBrut;

const CHEMINS = ARBRE_DEMO.map((noeud) => noeud.chemin);
const DOSSIERS = new Set(ARBRE_DEMO.filter((noeud) => noeud.contenu === null).map((noeud) => noeud.chemin));

const GIT_STATUS_DEMO = [
  'On branch nuit/2026-11-15',
  'Changes not staged for commit:',
  '  (use "git add <file>..." to update what will be committed)',
  '\tmodified:   src/donnees/monde-etat.ts',
  '',
  'Untracked files:',
  '\tsrc/donnees/bibliotheque.ts',
].join('\n');

export function estDossierDemo(chemin: string): boolean {
  return DOSSIERS.has(chemin);
}

export function executerCommande(ligne: string, cwd: string): ResultatCommande {
  const [commande = '', ...args] = ligne.trim().split(/\s+/);
  if (commande === '') return { sortie: '', cwd, effacer: false };
  const gestionnaire = GESTIONNAIRES[commande];
  const brut = gestionnaire ? gestionnaire(args, cwd) : { sortie: `${commande}: commande introuvable` };
  return { sortie: brut.sortie, cwd: brut.cwd ?? cwd, effacer: brut.effacer ?? false };
}

const GESTIONNAIRES: Readonly<Record<string, Gestionnaire | undefined>> = {
  ls: (args, cwd) => ({ sortie: listerLigne(resoudreChemin(cwd, args[0] ?? '.'), args[0]) }),
  pwd: (_args, cwd) => ({ sortie: cwd }),
  echo: (args) => ({ sortie: args.join(' ') }),
  cd: (args, cwd) => changerDossier(args[0] ?? PROJET_DEMO, cwd),
  git: (args, cwd) => gitDemo(args[0], cwd),
  clear: () => ({ sortie: '', effacer: true }),
};

function listerLigne(dossier: string, argument: string | undefined): string {
  if (!DOSSIERS.has(dossier)) return `ls: ${argument ?? dossier}: Aucun fichier ou dossier de ce type`;
  return enfantsDe(dossier, CHEMINS)
    .filter((chemin) => !nomDe(chemin).startsWith('.'))
    .map((chemin) => `${nomDe(chemin)}${DOSSIERS.has(chemin) ? '/' : ''}`)
    .sort((a, b) => a.localeCompare(b))
    .join('  ');
}

function changerDossier(argument: string, cwd: string): ResultatBrut {
  const cible = resoudreChemin(cwd, argument);
  if (!DOSSIERS.has(cible)) return { sortie: `cd: ${argument}: Aucun fichier ou dossier de ce type` };
  return { sortie: '', cwd: cible };
}

function gitDemo(sousCommande: string | undefined, cwd: string): ResultatBrut {
  if (!estDans(cwd, PROJET_DEMO)) {
    return { sortie: 'fatal: not a git repository (or any of the parent directories): .git' };
  }
  if (sousCommande === 'status') return { sortie: GIT_STATUS_DEMO };
  return { sortie: `git: « ${sousCommande ?? ''} » n’est pas une commande de la démo` };
}
