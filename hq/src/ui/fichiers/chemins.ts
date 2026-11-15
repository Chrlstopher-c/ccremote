// Responsabilité : les quelques opérations de chemin POSIX dont le panneau fichiers a besoin (joindre, parent, nom).
export function joindre(dossier: string, nom: string): string {
  return `${dossier.replace(/\/+$/, '')}/${nom}`;
}

export function parentDe(chemin: string): string | null {
  const net = chemin.replace(/\/+$/, '');
  if (net === '') return null;
  const i = net.lastIndexOf('/');
  return i <= 0 ? '/' : net.slice(0, i);
}

export function nomDe(chemin: string): string {
  return chemin.replace(/\/+$/, '').split('/').at(-1) ?? '';
}

/** Un nom d'entrée valide : non vide, sans « / », ni « . » ni « .. ». */
export function nomValide(nom: string): boolean {
  const n = nom.trim();
  return n !== '' && n !== '.' && n !== '..' && !n.includes('/');
}
