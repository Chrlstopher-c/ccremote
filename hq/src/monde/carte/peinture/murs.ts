// Responsabilité : dessiner un mur depuis le plan, façon The Escapists 2 — un dessus clair et fin qui suit le mur et se
// raccorde à ses voisins (angle, T, croix, bout), une face courte en briques sous tout mur horizontal et au bout bas
// d'un mur vertical, fenêtres percées dans la face. Rien n'est une tuile posée : les raccords sont justes par
// construction, quel que soit le plan.
import type { Carte } from '../plan';
import { ART } from './sols';

type Ctx = CanvasRenderingContext2D;

interface Boite {
  x0: number;
  y0: number;
  x1: number; // inclus
  y1: number; // inclus
}

export interface Voisins {
  n: boolean;
  e: boolean;
  s: boolean;
  o: boolean;
}

const COIFFE = '#d9cdb3';
const COIFFE_CLAIR = '#eee5d1';
const CONTOUR = '#4f4236';
const BRIQUE = { interieur: ['#a0705a', '#8e604b', '#6f4a39'], exterieur: ['#93553f', '#7f4734', '#5f3526'] } as const;

export const estMur = (carte: Carte, x: number, y: number): boolean => carte.cases[y]?.[x]?.nature === 'mur';

export function voisins(carte: Carte, x: number, y: number): Voisins {
  return { n: estMur(carte, x, y - 1), e: estMur(carte, x + 1, y), s: estMur(carte, x, y + 1), o: estMur(carte, x - 1, y) };
}

/** Le dessus du mur, en rectangles (centre + un bras vers chaque voisin mur). Pixels d'art dans la case. */
export function coiffe(v: Voisins): Boite[] {
  const b: Boite[] = [{ x0: 5, y0: 2, x1: 10, y1: 6 }];
  if (v.o) b.push({ x0: 0, y0: 2, x1: 4, y1: 6 });
  if (v.e) b.push({ x0: 11, y0: 2, x1: 15, y1: 6 });
  if (v.n) b.push({ x0: 5, y0: 0, x1: 10, y1: 1 });
  if (v.s) b.push({ x0: 5, y0: 7, x1: 10, y1: 15 });
  return b;
}

/** Bas de la face : elle déborde sur le premier rang de sol, comme la hauteur d'un mur vu un peu de face. */
export const BAS_FACE = 21;

/** La face visible sous le dessus : sous les bras horizontaux, ou sous le bout d'un mur vertical. */
export function face(v: Voisins): Boite[] {
  const b = BAS_FACE;
  const horizontal = v.o || v.e;
  if (!horizontal) return v.s ? [] : [{ x0: 5, y0: 7, x1: 10, y1: b }];
  if (!v.s) return [{ x0: v.o ? 0 : 5, y0: 7, x1: v.e ? 15 : 10, y1: b }];
  return [...(v.o ? [{ x0: 0, y0: 7, x1: 4, y1: b }] : []), ...(v.e ? [{ x0: 11, y0: 7, x1: 15, y1: b }] : [])];
}

function remplir(ctx: Ctx, ox: number, oy: number, b: Boite, c: string): void {
  ctx.fillStyle = c;
  ctx.fillRect(ox + b.x0, oy + b.y0, b.x1 - b.x0 + 1, b.y1 - b.y0 + 1);
}

/** Intérieur du dessus (sa couleur claire) : chaque rectangle rétréci d'un pixel sur ses bords exposés, le contour
 * sombre reste visible autour. */
export function coiffeInterieure(v: Voisins): Boite[] {
  const b: Boite[] = [{ x0: v.o ? 5 : 6, y0: v.n ? 2 : 3, x1: v.e ? 10 : 9, y1: v.s ? 6 : 5 }];
  if (v.o) b.push({ x0: 0, y0: 3, x1: 4, y1: 5 });
  if (v.e) b.push({ x0: 11, y0: 3, x1: 15, y1: 5 });
  if (v.n) b.push({ x0: 6, y0: 0, x1: 9, y1: 1 });
  if (v.s) b.push({ x0: 6, y0: 7, x1: 9, y1: 15 });
  return b;
}

function peindreCoiffe(ctx: Ctx, ox: number, oy: number, v: Voisins): void {
  for (const r of coiffe(v)) remplir(ctx, ox, oy, r, CONTOUR);
  for (const r of coiffeInterieure(v)) {
    remplir(ctx, ox, oy, r, COIFFE);
    if (r.y0 === 3) remplir(ctx, ox, oy, { ...r, y1: 3 }, COIFFE_CLAIR);
  }
}

function briques(ctx: Ctx, ox: number, oy: number, f: Boite, teintes: readonly string[]): void {
  const [base = '#000', joint = '#000', ombre = '#000'] = teintes;
  remplir(ctx, ox, oy, f, base);
  for (let y = f.y0 + 1, rang = 0; y < f.y1; y += 3, rang++) {
    if (y + 2 < f.y1) remplir(ctx, ox, oy, { ...f, y0: y + 2, y1: y + 2 }, joint);
    for (let x = f.x0 + (rang % 2 ? 3 : 0); x <= f.x1; x += 6) remplir(ctx, ox, oy, { x0: x, y0: y, x1: x, y1: y + 1 }, joint);
  }
  remplir(ctx, ox, oy, { ...f, y1: f.y0 }, CONTOUR);
  remplir(ctx, ox, oy, { ...f, y0: f.y1 }, ombre);
}

function fenetre(ctx: Ctx, ox: number, oy: number, f: Boite): void {
  if (f.x1 - f.x0 < 9) return;
  const verre = { x0: f.x0 + 2, y0: 9, x1: f.x1 - 2, y1: 17 };
  remplir(ctx, ox, oy, { x0: verre.x0 - 1, y0: 8, x1: verre.x1 + 1, y1: 18 }, '#e8dfcb');
  remplir(ctx, ox, oy, verre, '#6fa3cc');
  remplir(ctx, ox, oy, { ...verre, y1: 12 }, '#9cc7e6');
  remplir(ctx, ox, oy, { x0: verre.x0 + 2, y0: 10, x1: verre.x0 + 2, y1: 13 }, '#d6ecfa');
  remplir(ctx, ox, oy, { x0: (verre.x0 + verre.x1) >> 1, y0: verre.y0, x1: (verre.x0 + verre.x1) >> 1, y1: verre.y1 }, '#e8dfcb');
}

const dehorsAutour = (carte: Carte, x: number, y: number): boolean =>
  [-1, 0, 1].some((dy) => [-1, 0, 1].some((dx) => carte.cases[y + dy]?.[x + dx]?.nature === 'dehors'));

export function peindreMur(ctx: Ctx, carte: Carte, x: number, y: number, vitre: boolean): void {
  const v = voisins(carte, x, y);
  const ox = x * ART;
  const oy = y * ART;
  const teintes = dehorsAutour(carte, x, y) ? BRIQUE.exterieur : BRIQUE.interieur;
  for (const f of face(v)) {
    briques(ctx, ox, oy, f, teintes);
    if (f.x0 === 5) remplir(ctx, ox, oy, { ...f, x1: 5 }, CONTOUR);
    if (f.x1 === 10) remplir(ctx, ox, oy, { ...f, x0: 10 }, CONTOUR);
    if (vitre) fenetre(ctx, ox, oy, f);
  }
  peindreCoiffe(ctx, ox, oy, v);
}
