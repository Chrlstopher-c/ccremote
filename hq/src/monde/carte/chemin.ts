// Responsabilité : où l'on peut marcher (cases libres de la carte, moins l'emprise des meubles) et le plus court
// chemin entre deux points (A* sur la grille, 8 directions sans couper les coins). Pur, testable.
import { TUILE, type Carte } from './plan';

export interface Grille {
  w: number;
  h: number;
  libre: boolean[][]; // [y][x]
}

export interface PointMonde {
  x: number;
  y: number;
}

export function grilleDe(carte: Carte, emprises: Record<string, { w: number; emprise: number }>): Grille {
  const libre = carte.cases.map((ligne) => ligne.map((c) => c.nature === 'sol' || c.nature === 'dehors'));
  for (const o of carte.objets) {
    const e = emprises[o.nom];
    if (!o.bloque || !e) continue;
    const x0 = Math.floor((o.x - e.w / 2 + 4) / TUILE);
    const x1 = Math.floor((o.x + e.w / 2 - 4) / TUILE);
    const y0 = Math.floor((o.y - e.emprise) / TUILE);
    const y1 = Math.floor((o.y - 1) / TUILE);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (libre[y]?.[x] !== undefined) libre[y]![x] = false;
  }
  return { w: carte.largeur, h: carte.hauteur, libre };
}

const estLibre = (g: Grille, x: number, y: number): boolean => g.libre[y]?.[x] === true;

export function caseDe(p: PointMonde): { x: number; y: number } {
  return { x: Math.floor(p.x / TUILE), y: Math.floor((p.y - 1) / TUILE) };
}

/** Case libre la plus proche (recherche en anneaux), pour une destination posée sur un meuble. */
export function plusProcheLibre(g: Grille, c: { x: number; y: number }): { x: number; y: number } | null {
  for (let r = 0; r < 6; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) === r && estLibre(g, c.x + dx, c.y + dy)) {
          return { x: c.x + dx, y: c.y + dy };
        }
      }
    }
  }
  return null;
}

const VOISINS: readonly [number, number, number][] = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.414], [1, -1, 1.414], [-1, 1, 1.414], [-1, -1, 1.414],
];

/** Chemin en points du monde (centres de cases, le dernier = la destination exacte), ou null si inaccessible. */
export function chemin(g: Grille, de: PointMonde, vers: PointMonde): PointMonde[] | null {
  const a = plusProcheLibre(g, caseDe(de));
  const b = plusProcheLibre(g, caseDe(vers));
  if (!a || !b) return null;
  const cle = (x: number, y: number): number => y * g.w + x;
  const cout = new Map<number, number>([[cle(a.x, a.y), 0]]);
  const venu = new Map<number, number>();
  const ouverts: { k: number; f: number }[] = [{ k: cle(a.x, a.y), f: 0 }];
  while (ouverts.length) {
    ouverts.sort((p, q) => p.f - q.f);
    const k = ouverts.shift()!.k;
    if (k === cle(b.x, b.y)) return reconstruire(venu, k, g.w, vers);
    const x = k % g.w;
    const y = Math.floor(k / g.w);
    for (const [dx, dy, d] of VOISINS) {
      const nx = x + dx;
      const ny = y + dy;
      if (!estLibre(g, nx, ny) || (dx && dy && (!estLibre(g, x + dx, y) || !estLibre(g, x, y + dy)))) continue;
      const nk = cle(nx, ny);
      const c = (cout.get(k) ?? 0) + d;
      if (c >= (cout.get(nk) ?? Infinity)) continue;
      cout.set(nk, c);
      venu.set(nk, k);
      ouverts.push({ k: nk, f: c + Math.hypot(b.x - nx, b.y - ny) });
    }
  }
  return null;
}

function reconstruire(venu: Map<number, number>, fin: number, w: number, vers: PointMonde): PointMonde[] {
  const cases: number[] = [fin];
  let k = fin;
  while (venu.has(k)) {
    k = venu.get(k)!;
    cases.unshift(k);
  }
  const points = cases.slice(1).map((c) => ({ x: (c % w) * TUILE + TUILE / 2, y: Math.floor(c / w) * TUILE + TUILE - 4 }));
  points.push(vers);
  return points;
}
