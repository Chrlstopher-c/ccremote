// Responsabilité : le dessus des murs, calculé depuis le plan — une coiffe claire et fine qui suit le mur et se raccorde
// à ses voisins (angle, T, croix, bout) — et la largeur de la face que chaque mur montre sous lui (voir faces.ts).
// Rien n'est une tuile posée : les raccords sont justes par construction, quel que soit le plan.
import type { Carte } from '../plan';
import { ART } from './sols';

type Ctx = CanvasRenderingContext2D;

export interface Boite {
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
export const CONTOUR = '#4f4236';

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

/** Intérieur clair du dessus : chaque rectangle rétréci d'un pixel sur ses bords exposés (le contour reste visible). */
export function coiffeInterieure(v: Voisins): Boite[] {
  const b: Boite[] = [{ x0: v.o ? 5 : 6, y0: v.n ? 2 : 3, x1: v.e ? 10 : 9, y1: v.s ? 6 : 5 }];
  if (v.o) b.push({ x0: 0, y0: 3, x1: 4, y1: 5 });
  if (v.e) b.push({ x0: 11, y0: 3, x1: 15, y1: 5 });
  if (v.n) b.push({ x0: 6, y0: 0, x1: 9, y1: 1 });
  if (v.s) b.push({ x0: 6, y0: 7, x1: 9, y1: 15 });
  return b;
}

/** Colonnes (x0..x1 dans la case) où le mur montre sa face : sous ses bras horizontaux, ou sous le bout d'un mur
 * vertical. Un mur vertical qui continue vers le bas cache la face au milieu (son dessus passe devant). */
export function colonnesFace(v: Voisins): { x0: number; x1: number }[] {
  if (!(v.o || v.e)) return v.s ? [] : [{ x0: 5, x1: 10 }];
  if (!v.s) return [{ x0: v.o ? 0 : 5, x1: v.e ? 15 : 10 }];
  return [...(v.o ? [{ x0: 0, x1: 4 }] : []), ...(v.e ? [{ x0: 11, x1: 15 }] : [])];
}

export function remplir(ctx: Ctx, ox: number, oy: number, b: Boite, c: string): void {
  ctx.fillStyle = c;
  ctx.fillRect(ox + b.x0, oy + b.y0, b.x1 - b.x0 + 1, b.y1 - b.y0 + 1);
}

export function peindreCoiffe(ctx: Ctx, carte: Carte, x: number, y: number): void {
  const v = voisins(carte, x, y);
  const ox = x * ART;
  const oy = y * ART;
  for (const r of coiffe(v)) remplir(ctx, ox, oy, r, CONTOUR);
  for (const r of coiffeInterieure(v)) {
    remplir(ctx, ox, oy, r, COIFFE);
    if (r.y0 === 3) remplir(ctx, ox, oy, { ...r, y1: 3 }, COIFFE_CLAIR);
  }
}
