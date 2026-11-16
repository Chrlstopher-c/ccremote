// Responsabilité : peindre le sol d'une case (16 px d'art) selon son type — motifs procéduraux déterministes (même
// case, même dessin), dans la palette chaude de The Escapists 2.
import type { Sol } from '../plan';

export const ART = 16; // pixels d'art par case

type Ctx = CanvasRenderingContext2D;

/** Hasard déterministe tiré de la position. */
export function hasard(x: number, y: number, k = 0): number {
  let h = (x * 374761393 + y * 668265263 + k * 2246822519) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function px(ctx: Ctx, x: number, y: number, w: number, h: number, c: string): void {
  ctx.fillStyle = c;
  ctx.fillRect(x, y, w, h);
}

function bruit(ctx: Ctx, ox: number, oy: number, cx: number, cy: number, couleurs: readonly string[], n: number): void {
  for (let k = 0; k < n; k++) {
    const c = couleurs[Math.floor(hasard(cx, cy, k * 3) * couleurs.length)] ?? '#000';
    px(ctx, ox + Math.floor(hasard(cx, cy, k * 3 + 1) * ART), oy + Math.floor(hasard(cx, cy, k * 3 + 2) * ART), 1, 1, c);
  }
}

function herbe(ctx: Ctx, ox: number, oy: number, cx: number, cy: number): void {
  px(ctx, ox, oy, ART, ART, '#5f9e3f');
  bruit(ctx, ox, oy, cx, cy, ['#548f37', '#6aab48', '#4c8432'], 26);
  if (hasard(cx, cy, 99) < 0.45) {
    const x = ox + 2 + Math.floor(hasard(cx, cy, 98) * 11);
    const y = oy + 3 + Math.floor(hasard(cx, cy, 97) * 10);
    px(ctx, x, y, 1, 2, '#3f7a2b');
    px(ctx, x + 2, y, 1, 2, '#3f7a2b');
    px(ctx, x + 1, y + 1, 1, 2, '#467f2f');
  }
}

/** Lames de parquet : 4 rangs de 4 px, joints discrets, fins de lames décalées d'une case à l'autre. */
function parquet(ctx: Ctx, ox: number, oy: number, cx: number, cy: number, base: string, joint: string): void {
  px(ctx, ox, oy, ART, ART, base);
  for (let r = 0; r < 4; r++) {
    const y = oy + r * 4;
    px(ctx, ox, y + 3, ART, 1, joint);
    px(ctx, ox, y, ART, 1, 'rgba(255, 236, 200, 0.10)');
    if (hasard(cx, cy * 4 + r, 5) < 0.6) {
      const fin = ox + 2 + Math.floor(hasard(cx, cy * 4 + r, 6) * 12);
      px(ctx, fin, y, 1, 3, joint);
    }
    bruit(ctx, ox, y, cx * 4 + r, cy, ['rgba(255,240,210,0.08)', 'rgba(60,30,10,0.08)'], 4);
  }
}

function damier(ctx: Ctx, ox: number, oy: number, a: string, b: string, joint: string): void {
  for (let k = 0; k < 4; k++) {
    const x = ox + (k % 2) * 8;
    const y = oy + Math.floor(k / 2) * 8;
    px(ctx, x, y, 8, 8, k === 0 || k === 3 ? a : b);
    px(ctx, x, y, 8, 1, joint);
    px(ctx, x, y, 1, 8, joint);
  }
}

function dalles(ctx: Ctx, ox: number, oy: number, cx: number, cy: number): void {
  px(ctx, ox, oy, ART, ART, '#d3cab7');
  bruit(ctx, ox, oy, cx, cy, ['#cbc1ad', '#dad2c1'], 14);
  px(ctx, ox, oy, ART, 1, '#aea48f');
  px(ctx, ox, oy, 1, ART, '#aea48f');
  px(ctx, ox + 1, oy + 1, ART - 2, 1, '#e2dbcc');
}

/** Pas de porte : dalle claire et barre de seuil métallique au milieu. */
function seuil(ctx: Ctx, ox: number, oy: number, cx: number, cy: number): void {
  dalles(ctx, ox, oy, cx, cy);
  px(ctx, ox, oy + 6, ART, 3, '#9b9488');
  px(ctx, ox, oy + 6, ART, 1, '#c9c2b4');
}

function paves(ctx: Ctx, ox: number, oy: number, cx: number, cy: number): void {
  px(ctx, ox, oy, ART, ART, '#8f8b86');
  for (let r = 0; r < 2; r++) {
    const d = (r + cy) % 2 ? 4 : 0;
    for (let k = -1; k < 2; k++) {
      const x = ox + k * 8 + d;
      px(ctx, Math.max(ox, x + 1), oy + r * 8 + 1, Math.min(7, ox + ART - x - 1), 6, hasard(cx + k, cy + r, 7) < 0.5 ? '#a39f99' : '#9a958f');
    }
  }
}

function texture(ctx: Ctx, ox: number, oy: number, cx: number, cy: number, base: string, grains: readonly string[]): void {
  px(ctx, ox, oy, ART, ART, base);
  bruit(ctx, ox, oy, cx, cy, grains, 34);
}

export function peindreSol(ctx: Ctx, sol: Sol, cx: number, cy: number): void {
  const ox = cx * ART;
  const oy = cy * ART;
  switch (sol) {
    case 'herbe': return herbe(ctx, ox, oy, cx, cy);
    case 'allee': return texture(ctx, ox, oy, cx, cy, '#c9a46c', ['#b8935d', '#d7b47e', '#a9854f']);
    case 'paves': return paves(ctx, ox, oy, cx, cy);
    case 'dalles': return dalles(ctx, ox, oy, cx, cy);
    case 'seuil': return seuil(ctx, ox, oy, cx, cy);
    case 'parquet-a': return parquet(ctx, ox, oy, cx, cy, '#b98653', '#a2703f');
    case 'parquet-b': return parquet(ctx, ox, oy, cx, cy, '#a87a4d', '#91663b');
    case 'carrelage': return damier(ctx, ox, oy, '#ddd2bd', '#c2b59d', '#a8997f');
    case 'moquette-verte': return texture(ctx, ox, oy, cx, cy, '#4f7b5b', ['#47714f', '#57856a', '#436b4b']);
    case 'moquette-bleue': return texture(ctx, ox, oy, cx, cy, '#4b6391', ['#435a86', '#536c9c', '#3f5480']);
    case 'beton': return texture(ctx, ox, oy, cx, cy, '#8e9297', ['#858a8f', '#979ba0', '#7d8287']);
  }
}
