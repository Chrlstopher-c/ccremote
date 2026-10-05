// Responsabilité : où s'ouvre une session sans projet — un emplacement libre de la machine (~ par défaut). Pur.
import type { Projet } from '../../../commun/session.ts';

export const AUCUN_PROJET = '';
export const MAISON = '~';

/** Un emplacement libre (pas un projet découvert) : son nom est son dernier dossier, « maison » pour ~. */
export function projetLibre(machine: string, emplacement: string): Projet {
  const chemin = emplacement.trim() || MAISON;
  const nom = chemin === MAISON ? 'maison' : (chemin.replace(/\/+$/, '').split('/').pop() ?? chemin) || chemin;
  return { machine, chemin, nom };
}
