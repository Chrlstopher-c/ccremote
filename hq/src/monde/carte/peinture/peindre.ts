// Responsabilité : peindre toute la carte dans une seule toile (16 px d'art par case, affichée ×2) : sols, ombres,
// soleil des fenêtres, faces des murs (à l'échelle des personnages), puis le dessus des murs. Les personnages et les meubles se posent par-dessus dans Phaser.
import type { Carte, Sol } from '../plan';
import { ombrePied, peindreFace, RANGS_FACE } from './faces';
import { coiffe, estMur, peindreCoiffe, voisins } from './murs';
import { ART, peindreSol } from './sols';

type Ctx = CanvasRenderingContext2D;

/** Sol peint sous un mur : à gauche celui de la case de gauche, à droite celui de droite, à défaut au-dessus/dessous. */
function solVoisin(carte: Carte, x: number, y: number, dx: number): Sol {
  for (const [ax, ay] of [[x + dx, y], [x, y - 1], [x, y + 1]] as const) {
    const c = carte.cases[ay]?.[ax];
    if (c && c.nature !== 'mur' && c.nature !== 'face') return c.sol;
  }
  return carte.cases[y]?.[x]?.sol ?? 'herbe';
}

function peindreSols(ctx: Ctx, carte: Carte): void {
  carte.cases.forEach((ligne, y) => ligne.forEach((c, x) => {
    if (c.nature !== 'mur') return peindreSol(ctx, c.sol, x, y);
    for (const [dx, x0] of [[-1, 0], [1, ART / 2]] as const) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(x * ART + x0, y * ART, ART / 2, ART);
      ctx.clip();
      peindreSol(ctx, solVoisin(carte, x, y, dx), x, y);
      ctx.restore();
    }
  }));
}

/** Ombre douce du dessus des murs vers le bas à droite : sa forme répétée, décalée de 1 à 3 pixels. */
function peindreOmbres(ctx: Ctx, carte: Carte): void {
  ctx.fillStyle = 'rgba(25, 12, 30, 0.16)';
  carte.cases.forEach((ligne, y) => ligne.forEach((_c, x) => {
    if (!estMur(carte, x, y)) return;
    const v = voisins(carte, x, y);
    for (const d of [1, 2, 3]) {
      for (const b of coiffe(v)) {
        ctx.fillRect(x * ART + b.x0 + d, y * ART + b.y0 + d, b.x1 - b.x0 + 1, b.y1 - b.y0 + 1);
      }
    }
  }));
}

/** Taches de soleil : chaque fenêtre qui donne sur l'intérieur projette un parallélogramme de lumière sur le sol. */
function peindreSoleil(ctx: Ctx, carte: Carte): void {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = 'rgba(255, 226, 160, 0.07)';
  for (const f of carte.fenetres) {
    if (carte.cases[f.y + RANGS_FACE + 1]?.[f.x]?.nature !== 'sol') continue;
    const x = f.x * ART + 2;
    const y = (f.y + RANGS_FACE + 1) * ART;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + 12, y);
    ctx.lineTo(x + 34, y + 44);
    ctx.lineTo(x + 22, y + 44);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

export function peindreCarte(carte: Carte): HTMLCanvasElement {
  const toile = document.createElement('canvas');
  toile.width = carte.largeur * ART;
  toile.height = carte.hauteur * ART;
  const ctx = toile.getContext('2d');
  if (!ctx) return toile;
  ctx.imageSmoothingEnabled = false;
  peindreSols(ctx, carte);
  peindreOmbres(ctx, carte);
  peindreSoleil(ctx, carte);
  const vitres = new Set(carte.fenetres.map((f) => `${f.x},${f.y}`));
  const murs = carte.cases.flatMap((ligne, y) => ligne.flatMap((_c, x) => (estMur(carte, x, y) ? [{ x, y }] : [])));
  for (const m of murs) ombrePied(ctx, carte, m.x, m.y);
  for (const m of murs) peindreFace(ctx, carte, m.x, m.y, vitres.has(`${m.x},${m.y}`));
  for (const m of murs) peindreCoiffe(ctx, carte, m.x, m.y);
  return toile;
}
