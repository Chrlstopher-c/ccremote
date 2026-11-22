// Responsabilité : lire la sortie du script distant — étapes, empreintes, identifiant de membre — et en rendre une fin
// lisible sans identifiant d'infrastructure. Pur.
import { assainirSortie } from '../machines/installations.ts';

export interface SortieNoeud {
  readonly sha: string | null;
  readonly membre: string | null;
  readonly empreinte: string | null;
  readonly empreintePair: string | null;
  readonly dejaAppaire: boolean;
  readonly relie: boolean;
  readonly fin: boolean;
}

const EMPREINTE = /^[0-9A-F]{4}( [0-9A-F]{4}){15}$/;

/** Une ligne « @etape x » : x ; sinon null. */
export function etapeDistante(ligne: string): string | null {
  return ligne.startsWith('@etape ') ? ligne.slice(7).trim() : null;
}

export function lireSortie(texte: string): SortieNoeud {
  const valeur = (cle: string): string | null => {
    const ligne = texte.split('\n').reverse().find((l) => l.startsWith(`@${cle} `));
    return ligne ? ligne.slice(cle.length + 2).trim() : null;
  };
  const sha = valeur('sha');
  const membre = valeur('membre');
  const empreinte = valeur('empreinte');
  const empreintePair = valeur('empreinte-pair');
  const lignes = new Set(texte.split('\n').map((l) => l.trim()));
  return {
    sha: sha && /^[a-f0-9]{12}$/.test(sha) ? sha : null,
    membre: membre && /^[a-f0-9]{12}$/.test(membre) ? membre : null,
    empreinte: empreinte && EMPREINTE.test(empreinte) ? empreinte : null,
    empreintePair: empreintePair && EMPREINTE.test(empreintePair) ? empreintePair : null,
    dejaAppaire: lignes.has('@deja-appaire'),
    relie: lignes.has('@relie'),
    fin: lignes.has('@fin'),
  };
}

/** Fin de sortie d'un échec, lisible : sans lignes « @ », sans hôte, utilisateur ni adresse. */
export function messageEchec(sortie: string, erreurs: string, hote: string): string {
  const utiles = `${sortie}\n${erreurs}`
    .split('\n')
    .filter((l) => !l.startsWith('@'))
    .join('\n');
  return assainirSortie(utiles, hote) || 'échec sans message';
}
