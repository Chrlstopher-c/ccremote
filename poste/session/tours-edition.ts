// Responsabilité : les modifications d'un fichier qu'un résultat d'outil d'écriture porte dans le transcript (Edit,
// MultiEdit, Write, NotebookEdit). Le résultat garde le `structuredPatch` de la modification (hunks au format diff) ;
// une création (Write `type: create`) n'a que son contenu. Un résultat sans patch ni contenu ne donne aucun chiffre :
// rendu null, le fichier n'est pas compté plutôt que compté faux. Pur.
type Objet = Record<string, unknown>;

export interface AppelEcriture {
  readonly nom: string;
  readonly chemin: string | null;
}

export interface EditionFichier {
  readonly chemin: string;
  readonly creation: boolean;
  readonly ajouts: number;
  readonly suppressions: number;
}

export const OUTILS_ECRITURE: ReadonlySet<string> = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit']);

/** Modification d'un fichier relevée dans le résultat d'un outil d'écriture ; null si ses chiffres sont inconnus. */
export function editionDe(appel: AppelEcriture, resultat: Objet): EditionFichier | null {
  const chemin = chaine(resultat['filePath']) ?? appel.chemin;
  if (chemin === null) return null;
  if (resultat['type'] === 'create' && typeof resultat['content'] === 'string') {
    return { chemin, creation: true, ajouts: lignes(resultat['content']), suppressions: 0 };
  }
  const patch = resultat['structuredPatch'];
  if (!Array.isArray(patch)) return null;
  const { ajouts, suppressions } = comptesDePatch(patch);
  return { chemin, creation: false, ajouts, suppressions };
}

function comptesDePatch(patch: readonly unknown[]): { ajouts: number; suppressions: number } {
  let ajouts = 0;
  let suppressions = 0;
  for (const hunk of patch) {
    const texte = objetDe(hunk)?.['lines'];
    if (!Array.isArray(texte)) continue;
    for (const ligne of texte) {
      if (typeof ligne !== 'string') continue;
      if (ligne.startsWith('+')) ajouts += 1;
      else if (ligne.startsWith('-')) suppressions += 1;
    }
  }
  return { ajouts, suppressions };
}

function lignes(contenu: string): number {
  if (contenu === '') return 0;
  return contenu.split('\n').length - (contenu.endsWith('\n') ? 1 : 0);
}

function chaine(v: unknown): string | null {
  return typeof v === 'string' && v !== '' ? v : null;
}

// Objet JSON (non tableau) : la forme n'est pas contrôlée au-delà, chaque lecture la vérifie.
function objetDe(v: unknown): Objet | null {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Objet) : null;
}
