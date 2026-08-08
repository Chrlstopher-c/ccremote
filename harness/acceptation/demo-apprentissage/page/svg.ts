/**
 * Responsabilité : primitives SVG pures — échelles, axes, formes. Aucune donnée métier
 * ici : chaque fonction reçoit ses valeurs en paramètre, rien n'est écrit en dur hors
 * constantes purement graphiques (épaisseurs de trait, tailles de police).
 */

import { echapper } from './utils.ts';

export type Echelle = (valeur: number) => number;

/** Échelle linéaire pure : projette `domaine` sur `image`. Domaine dégénéré → milieu de l'image. */
export function echelleLineaire(domaine: readonly [number, number], image: readonly [number, number]): Echelle {
  const [dMin, dMax] = domaine;
  const [iMin, iMax] = image;
  const etendue = dMax - dMin;
  if (etendue === 0) return () => (iMin + iMax) / 2;
  return (valeur: number) => iMin + ((valeur - dMin) / etendue) * (iMax - iMin);
}

/** Maximum d'une série pouvant contenir des `null`, ignorés. `repli` si aucune valeur exploitable. */
export function maxDe(valeurs: readonly (number | null)[], repli = 1): number {
  const exploitables = valeurs.filter((v): v is number => v !== null);
  if (exploitables.length === 0) return repli;
  const max = Math.max(...exploitables);
  return max === 0 ? repli : max;
}

interface OptionsLigne {
  readonly couleur?: string;
  readonly epaisseur?: number;
  readonly tirets?: string;
}

export function ligneSvg(x1: number, y1: number, x2: number, y2: number, options: OptionsLigne = {}): string {
  const couleur = options.couleur ?? 'var(--texte-faible)';
  const epaisseur = options.epaisseur ?? 1;
  const tirets = options.tirets !== undefined ? ` stroke-dasharray="${options.tirets}"` : '';
  return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${couleur}" ` +
    `stroke-width="${epaisseur}"${tirets} />`;
}

interface OptionsRectangle {
  readonly couleur?: string;
  readonly rayon?: number;
  readonly remplissage?: string;
}

export function rectangleSvg(x: number, y: number, largeur: number, hauteur: number, options: OptionsRectangle = {}): string {
  const rayon = options.rayon ?? 2;
  const remplissage = options.remplissage ?? options.couleur ?? 'var(--bord)';
  const largeurBornee = Math.max(largeur, 0);
  const hauteurBornee = Math.max(hauteur, 0);
  return `<rect x="${x}" y="${y}" width="${largeurBornee}" height="${hauteurBornee}" rx="${rayon}" ` +
    `fill="${remplissage}" />`;
}

interface OptionsTexte {
  readonly ancre?: 'start' | 'middle' | 'end';
  readonly couleur?: string;
  readonly taille?: number;
  readonly poids?: number;
}

export function texteSvg(x: number, y: number, contenu: string, options: OptionsTexte = {}): string {
  const ancre = options.ancre ?? 'start';
  const couleur = options.couleur ?? 'var(--texte-doux)';
  const taille = options.taille ?? 11;
  const poids = options.poids ?? 400;
  return `<text x="${x}" y="${y}" text-anchor="${ancre}" fill="${couleur}" font-size="${taille}" ` +
    `font-weight="${poids}">${echapper(contenu)}</text>`;
}

/** Motif de hachures pour une barre « jamais » (tentative sans succès). `id` doit être unique dans le document. */
export function defsHachures(id: string, couleur: string): string {
  return `<defs><pattern id="${id}" patternUnits="userSpaceOnUse" width="6" height="6" ` +
    `patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="6" stroke="${couleur}" stroke-width="2" />` +
    `</pattern></defs>`;
}

/**
 * `☠` Pas d'attribut `xmlns` ici : le document est servi en HTML5 (`text/html`), où le
 * parseur place déjà `<svg>` dans le bon espace de noms. Un `xmlns="http://…"` littéral
 * ferait échouer la vérification « aucune URL externe » du générateur, pour rien.
 */
export function ouvrirSvg(largeur: number, hauteur: number, contenu: string): string {
  return `<svg viewBox="0 0 ${largeur} ${hauteur}" width="100%" height="${hauteur}">${contenu}</svg>`;
}
