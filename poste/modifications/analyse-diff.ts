// Responsabilité : lecture pure des sorties de git (`--name-status -z`, `--numstat -z`, diff unifié) et du contenu d'un
// fichier non suivi. Aucune E/S : équivalent de crates/lanterne-poste/src/analyse.rs.
import type { EtatFichier, GenreLigne, Hunk, LigneDiff } from '../../commun/modifications.ts';

export interface ChangementSuivi {
  readonly chemin: string;
  readonly etat: EtatFichier;
  readonly ajouts: number;
  readonly suppressions: number;
  readonly binaire: boolean;
}

export interface CompteFichier {
  readonly chemin: string;
  readonly ajouts: number;
  readonly suppressions: number;
  readonly binaire: boolean;
}

// Lignes d'un texte, comme `str::lines` : pas de ligne vide finale, CRLF accepté.
export function lignesDe(texte: string): string[] {
  if (texte === '') return [];
  return texte
    .replace(/\r?\n$/, '')
    .split('\n')
    .map((ligne) => ligne.replace(/\r$/, ''));
}

export function compterLignes(texte: string): number {
  return lignesDe(texte).length;
}

const ETAT_PAR_CODE: Readonly<Record<string, EtatFichier>> = { A: 'ajoute', D: 'supprime', M: 'modifie', T: 'modifie' };

/** Associe chaque chemin de `--name-status -z` à son état (les renommages sont désactivés à l'appel). */
export function etatsNameStatus(sortie: string): { etat: EtatFichier; chemin: string }[] {
  const morceaux = sortie.split('\0').filter((morceau) => morceau !== '');
  const resultat: { etat: EtatFichier; chemin: string }[] = [];
  for (let i = 0; i + 1 < morceaux.length; i += 2) {
    const etat = ETAT_PAR_CODE[(morceaux[i] ?? '').charAt(0)];
    if (etat) resultat.push({ etat, chemin: morceaux[i + 1] ?? '' });
  }
  return resultat;
}

/** Comptes par fichier de `--numstat -z` (sans renommage) : `ajouts<TAB>retraits<TAB>chemin`, `-` pour un binaire. */
export function comptesNumstat(sortie: string): CompteFichier[] {
  const comptes: CompteFichier[] = [];
  for (const enregistrement of sortie.split('\0')) {
    const [ajouts, retraits, ...reste] = enregistrement.split('\t');
    const chemin = reste.join('\t');
    if (ajouts === undefined || retraits === undefined || chemin === '') continue;
    comptes.push({
      chemin,
      ajouts: nombreOuZero(ajouts),
      suppressions: nombreOuZero(retraits),
      binaire: ajouts === '-' || retraits === '-',
    });
  }
  return comptes;
}

function nombreOuZero(valeur: string): number {
  const n = Number.parseInt(valeur, 10);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/** Hunks d'une sortie de `git diff -U3` ; les en-têtes de fichier (avant le premier `@@`) sont ignorés. */
export function hunksUnifies(sortie: string): Hunk[] {
  const hunks: Hunk[] = [];
  let ancien = 0;
  let nouveau = 0;
  let courant: Hunk | null = null;
  for (const ligne of lignesDe(sortie)) {
    const entete = enteteHunk(ligne);
    if (entete) {
      ancien = entete.ancien;
      nouveau = entete.nouveau;
      courant = { ancienDebut: ancien, nouveauDebut: nouveau, lignes: [] };
      hunks.push(courant);
      continue;
    }
    if (!courant) continue;
    const ajout = ligneDe(courant, ligne, '+', 'ajout', null, nouveau);
    if (ajout) {
      nouveau += 1;
      continue;
    }
    const retrait = ligneDe(courant, ligne, '-', 'retrait', ancien, null);
    if (retrait) {
      ancien += 1;
      continue;
    }
    if (ligneDe(courant, ligne, ' ', 'contexte', ancien, nouveau)) {
      ancien += 1;
      nouveau += 1;
    }
  }
  return hunks;
}

// Ajoute une ligne au hunk si elle commence par le préfixe ; `ancien`/`nouveau` sont les numéros de la ligne.
function ligneDe(
  hunk: Hunk,
  ligne: string,
  prefixe: string,
  genre: GenreLigne,
  ancien: number | null,
  nouveau: number | null,
): boolean {
  if (!ligne.startsWith(prefixe)) return false;
  const ligneDiff: LigneDiff = { genre, ancien, nouveau, texte: ligne.slice(1) };
  hunk.lignes.push(ligneDiff);
  return true;
}

/** Lit `@@ -a[,b] +c[,d] @@` et renvoie les débuts (ancien, nouveau). */
function enteteHunk(ligne: string): { ancien: number; nouveau: number } | null {
  const correspondance = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(ligne);
  if (!correspondance) return null;
  return { ancien: Number(correspondance[1]), nouveau: Number(correspondance[2]) };
}

/** Hunk unique d'un fichier entièrement nouveau (non suivi) : toutes ses lignes sont des ajouts. */
export function hunkNouveauFichier(texte: string): Hunk[] {
  const lignes = lignesDe(texte);
  if (lignes.length === 0) return [];
  return [
    {
      ancienDebut: 0,
      nouveauDebut: 1,
      lignes: lignes.map((ligne, indice) => ({ genre: 'ajout', ancien: null, nouveau: indice + 1, texte: ligne })),
    },
  ];
}
