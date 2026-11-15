// Responsabilité : les chemins POSIX absolus d'un poste (fichiers, terminaux) — fonctions pures, sans module Node,
// utilisables dans le navigateur. Un chemin normalisé commence par « / » et n'a ni « // » ni « / » final.
const decouper = (chemin: string): string[] => chemin.split('/').filter((morceau) => morceau !== '');

export function resoudreChemin(base: string, cible: string): string {
  const pile = cible.startsWith('/') ? [] : decouper(base);
  for (const morceau of decouper(cible)) {
    if (morceau === '..') pile.pop();
    else if (morceau !== '.') pile.push(morceau);
  }
  return `/${pile.join('/')}`;
}

export function normaliser(chemin: string): string {
  return resoudreChemin('/', chemin);
}

export function nomDe(chemin: string): string {
  return decouper(chemin).at(-1) ?? '';
}

export function parentDe(chemin: string): string | null {
  const morceaux = decouper(normaliser(chemin));
  if (morceaux.length === 0) return null;
  return `/${morceaux.slice(0, -1).join('/')}`;
}

export function joindre(dossier: string, nom: string): string {
  return normaliser(`${dossier}/${nom}`);
}

/** Vrai si le chemin est la racine elle-même ou se trouve sous elle. */
export function estDans(chemin: string, racine: string): boolean {
  const c = normaliser(chemin);
  const r = normaliser(racine);
  return r === '/' || c === r || c.startsWith(`${r}/`);
}

/** Déplace un chemin de l'arborescence `de` vers `vers` (le chemin doit être dans `de`). */
export function deplacer(chemin: string, de: string, vers: string): string {
  return normaliser(vers) + normaliser(chemin).slice(normaliser(de).length);
}

/** Enfants directs de `dossier` parmi `chemins`, dans l'ordre reçu. */
export function enfantsDe(dossier: string, chemins: Iterable<string>): string[] {
  const parent = normaliser(dossier);
  return [...chemins].filter((c) => normaliser(c) !== parent && parentDe(c) === parent);
}
