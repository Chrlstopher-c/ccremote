// Responsabilité : parcourir les dossiers d'une machine SSH — commande distante et lecture de sa sortie, au format
// ListeDossier du poste (même forme que la navigation d'un poste connecté).
import type { ListeDossier } from '../../commun/appareil.ts';
import { cheminShell } from './modele.ts';
import type { ConnexionSsh, Ssh } from './ssh.ts';

export function commandeListerDossiers(chemin: string): string {
  return [
    `cd -- ${cheminShell(chemin)} 2>/dev/null || { echo 'dossier introuvable' >&2; exit 3; }`,
    `printf '%s\\n' "$(pwd -P)" "$HOME"`,
    `find . -mindepth 1 -maxdepth 1 -type d ! -name '.*' -printf '%f\\n' | LC_ALL=C sort`,
  ].join(' && ');
}

/** Lit la sortie de la commande : chemin réel, accueil, puis les dossiers visibles (un par ligne). */
export function lireListeDossiers(sortie: string): ListeDossier | null {
  const lignes = sortie.split('\n');
  const [chemin, accueil] = lignes;
  if (!chemin || !accueil) return null;
  const entrees = lignes
    .slice(2)
    .filter((nom) => nom.length > 0)
    .map((nom) => ({ nom, type: 'dossier' as const, taille: 0, modifie: '', cache: false }));
  return { chemin, parent: parentDe(chemin), accueil, entrees };
}

export function parentDe(chemin: string): string | null {
  if (chemin === '/') return null;
  const i = chemin.lastIndexOf('/');
  return i <= 0 ? '/' : chemin.slice(0, i);
}

export type ResultatDossiers = { ok: true; liste: ListeDossier } | { ok: false; erreur: string };

export async function listerDossiersSsh(
  ssh: Ssh,
  c: ConnexionSsh,
  chemin: string,
): Promise<ResultatDossiers> {
  const r = await ssh.executer(c, commandeListerDossiers(chemin), null, 20_000);
  if (r.code !== 0) return { ok: false, erreur: messageSsh(r.code, r.erreurs, r.delaiDepasse) };
  const liste = lireListeDossiers(r.sortie);
  return liste ? { ok: true, liste } : { ok: false, erreur: 'sortie distante illisible' };
}

export function messageSsh(code: number, erreurs: string, delaiDepasse: boolean): string {
  if (delaiDepasse) return 'délai dépassé';
  const premiere = erreurs.trim().split('\n').at(-1) ?? '';
  return premiere || `ssh a échoué (code ${code})`;
}
