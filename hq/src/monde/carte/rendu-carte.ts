// Responsabilité : dessiner la carte dans Phaser — sol et murs en tuiles (une couche), meubles en images triées par
// profondeur (le bas de l'objet), plaques des bureaux.
import type Phaser from 'phaser';

import type { InfoObjet } from '../sprites';
import { TUILE, type Carte } from './plan';

export const POLICE = '"Pixelify Sans", monospace';

const estMur = (carte: Carte, x: number, y: number): boolean => carte.cases[y]?.[x]?.nature === 'mur';

/** Sous un mur fin, on voit le sol d'à côté : celui d'une case voisine praticable (sol d'abord, puis dehors). */
function solSous(carte: Carte, x: number, y: number): string {
  const dessous = carte.cases[y + 1]?.[x];
  if (dessous?.nature === 'face') return dessous.tuile; // le haut du mur se prolonge sur sa face
  const voisins = [[0, 1], [1, 0], [-1, 0], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]];
  for (const nature of ['sol', 'dehors'] as const) {
    for (const [dx, dy] of voisins) {
      const c = carte.cases[y + (dy ?? 0)]?.[x + (dx ?? 0)];
      if (c?.nature === nature) return c.tuile;
    }
  }
  return 'herbe-0';
}

function masqueMur(carte: Carte, x: number, y: number): number {
  return (estMur(carte, x, y - 1) ? 1 : 0) | (estMur(carte, x + 1, y) ? 2 : 0) | (estMur(carte, x, y + 1) ? 4 : 0) |
    (estMur(carte, x - 1, y) ? 8 : 0);
}

/** Mur extérieur, ou mur qui montre sa face : épais et plein (le haut du mur) ; mur vertical intérieur : fin. */
function nomMur(carte: Carte, x: number, y: number): string {
  if (carte.cases[y + 1]?.[x]?.nature === 'face') return 'mur-dessus';
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const c = carte.cases[y + dy]?.[x + dx];
      if (c?.nature === 'dehors' || c?.tuile.startsWith('facade')) return 'mur-dessus';
    }
  }
  return `mur-${masqueMur(carte, x, y)}`;
}

export function dessinerCarte(scene: Phaser.Scene, carte: Carte, tuiles: Record<string, number>): void {
  const sol = carte.cases.map((l, y) => l.map((c, x) => tuiles[c.nature === 'mur' ? solSous(carte, x, y) : c.tuile] ?? 0));
  const murs = carte.cases.map((l, y) => l.map((c, x) => (c.nature === 'mur' ? tuiles[nomMur(carte, x, y)] ?? -1 : -1)));
  for (const [donnees, profondeur] of [[sol, -10], [murs, -9]] as const) {
    const map = scene.make.tilemap({ data: donnees.map((l) => [...l]), tileWidth: TUILE, tileHeight: TUILE });
    const jeu = map.addTilesetImage('tuiles', 'tuiles', TUILE, TUILE, 0, 0);
    if (jeu) map.createLayer(0, jeu, 0, 0)?.setDepth(profondeur);
  }
}

export function poserObjets(
  scene: Phaser.Scene,
  carte: Carte,
  objets: Record<string, InfoObjet>,
): { nom: string; image: Phaser.GameObjects.Image }[] {
  const poses: { nom: string; image: Phaser.GameObjects.Image }[] = [];
  for (const o of carte.objets) {
    if (!objets[o.nom]) continue;
    const img = scene.add.image(o.x, o.y, `objet-${o.nom}`).setOrigin(0.5, 1).setDepth(o.auSol ? -5 : o.y);
    if (o.miroir) img.setFlipX(true);
    poses.push({ nom: o.nom, image: img });
  }
  return poses;
}

export function poserPlaques(scene: Phaser.Scene, carte: Carte): void {
  for (const p of carte.postes) {
    const t = scene.add.text(p.plaque.x, p.plaque.y, p.projet, {
      fontFamily: POLICE,
      fontSize: '13px',
      color: '#3b2a1a',
      resolution: 3,
    });
    t.setOrigin(0.5).setPadding(6, 2, 6, 2).setBackgroundColor('#e9d7b5').setDepth(5);
  }
}
