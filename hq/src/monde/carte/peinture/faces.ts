// Responsabilité : la face des murs, à l'échelle des personnages (un peu plus haute que Chris, comme le mur du mod
// Desktop) : sous le dessus du mur, 41 rangs d'art qui couvrent le bas de sa case et les deux rangs du dessous.
// Dedans : plâtre, moulure, soubassement en bois et plinthe, avec cadres ; dehors : briques et soubassement de pierre.
// Les fenêtres se percent dans la face.
import type { Carte } from '../plan';
import { colonnesFace, CONTOUR, remplir, voisins } from './murs';
import { ART, hasard } from './sols';

type Ctx = CanvasRenderingContext2D;

export const HAUT_FACE = 41; // rangs d'art, depuis le bas du dessus du mur (rang 7 de sa case)
export const RANGS_FACE = 2; // rangs de cases occupés sous le mur

type Style = 'dedans' | 'dehors';

/** Couleur du rang `r` de la face (0 = juste sous le dessus du mur). */
function teinteDedans(r: number): string {
  if (r === 0) return '#3a2a20';
  if (r <= 2) return r === 1 ? '#9a6a44' : '#7d5235';
  if (r <= 24) return r === 3 ? '#cdbb98' : '#e4d4b4';
  if (r === 25) return '#7d5235';
  if (r <= 37) return r === 26 ? '#b98352' : '#a06b43';
  return r <= 39 ? '#5a3a24' : '#3a2618';
}

function teinteDehors(r: number, x: number): string {
  if (r === 0) return CONTOUR;
  if (r >= 36) return r === 36 ? '#9a9389' : r >= 40 ? '#4f4a44' : '#7c746a';
  const rang = Math.floor((r - 1) / 3);
  if ((r - 1) % 3 === 2) return '#6a3a2a';
  return (x + (rang % 2) * 3) % 6 === 0 ? '#6a3a2a' : '#93553f';
}

function peindreColonnes(ctx: Ctx, ox: number, oy: number, x0: number, x1: number, style: Style): void {
  for (let r = 0; r < HAUT_FACE; r++) {
    if (style === 'dedans') {
      remplir(ctx, ox, oy, { x0, y0: 7 + r, x1, y1: 7 + r }, teinteDedans(r));
      continue;
    }
    for (let x = x0; x <= x1; x++) remplir(ctx, ox, oy, { x0: x, y0: 7 + r, x1: x, y1: 7 + r }, teinteDehors(r, x));
  }
  if (style === 'dedans') {
    for (let x = x0 + 3; x <= x1; x += 8) remplir(ctx, ox, oy, { x0: x, y0: 34, x1: x, y1: 43 }, '#86572f');
  }
}

function fenetre(ctx: Ctx, ox: number, oy: number, x0: number, x1: number): void {
  if (x1 - x0 < 11) return;
  const v = { x0: x0 + 2, y0: 14, x1: x1 - 2, y1: 31 };
  remplir(ctx, ox, oy, { x0: v.x0 - 1, y0: v.y0 - 1, x1: v.x1 + 1, y1: v.y1 + 2 }, '#efe6d2');
  remplir(ctx, ox, oy, v, '#79acd3');
  remplir(ctx, ox, oy, { ...v, y1: 21 }, '#a3cbe9');
  remplir(ctx, ox, oy, { x0: v.x0 + 2, y0: v.y0 + 2, x1: v.x0 + 2, y1: v.y0 + 6 }, '#e1f1fc');
  remplir(ctx, ox, oy, { x0: (v.x0 + v.x1) >> 1, y0: v.y0, x1: (v.x0 + v.x1) >> 1, y1: v.y1 }, '#efe6d2');
  remplir(ctx, ox, oy, { ...v, y0: 23, y1: 23 }, '#efe6d2');
}

/** Un cadre accroché au plâtre, de temps en temps : la pièce paraît habitée. */
function cadre(ctx: Ctx, ox: number, oy: number, x: number, y: number): void {
  const teintes = ['#6f9c6a', '#c98a5a', '#5d7fae', '#b8a45a'];
  const t = teintes[Math.floor(hasard(x, y, 41) * teintes.length)] ?? '#6f9c6a';
  remplir(ctx, ox, oy, { x0: 3, y0: 15, x1: 12, y1: 25 }, '#5a3a24');
  remplir(ctx, ox, oy, { x0: 4, y0: 16, x1: 11, y1: 24 }, t);
  remplir(ctx, ox, oy, { x0: 4, y0: 21, x1: 11, y1: 24 }, '#00000022');
  remplir(ctx, ox, oy, { x0: 3, y0: 26, x1: 12, y1: 26 }, '#00000030');
}

/** Face d'un mur dedans ou dehors : selon ce qu'il y a au pied de la face. */
function styleDe(carte: Carte, x: number, y: number): Style {
  return carte.cases[y + RANGS_FACE + 1]?.[x]?.nature === 'dehors' ? 'dehors' : 'dedans';
}

export function peindreFace(ctx: Ctx, carte: Carte, x: number, y: number, vitre: boolean): void {
  const v = voisins(carte, x, y);
  const ox = x * ART;
  const oy = y * ART;
  const style = styleDe(carte, x, y);
  const couloir = carte.cases[y + RANGS_FACE + 1]?.[x]?.sol === 'dalles'; // les plaques des portes y sont accrochées
  for (const c of colonnesFace(v)) {
    peindreColonnes(ctx, ox, oy, c.x0, c.x1, style);
    if (c.x0 > 0 || !v.o) remplir(ctx, ox, oy, { x0: c.x0, y0: 7, x1: c.x0, y1: 7 + HAUT_FACE - 1 }, CONTOUR);
    if (c.x1 < 15 || !v.e) remplir(ctx, ox, oy, { x0: c.x1, y0: 7, x1: c.x1, y1: 7 + HAUT_FACE - 1 }, CONTOUR);
    if (vitre) fenetre(ctx, ox, oy, c.x0, c.x1);
    else if (style === 'dedans' && !couloir && c.x0 === 0 && c.x1 === 15 && hasard(x, y, 40) < 0.16) cadre(ctx, ox, oy, x, y);
  }
}

/** Ombre au pied de la face (le sol juste devant le mur est plus sombre). */
export function ombrePied(ctx: Ctx, carte: Carte, x: number, y: number): void {
  const pied = (y + RANGS_FACE + 1) * ART;
  for (const c of colonnesFace(voisins(carte, x, y))) {
    for (const [d, a] of [[0, 0.3], [1, 0.2], [2, 0.12], [3, 0.06]] as const) {
      ctx.fillStyle = `rgba(30, 15, 25, ${a})`;
      ctx.fillRect(x * ART + c.x0, pied + d, c.x1 - c.x0 + 1, 1);
    }
  }
}
