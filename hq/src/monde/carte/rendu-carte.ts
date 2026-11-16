// Responsabilité : poser la carte dans Phaser — la toile peinte (sols, murs, ombres, soleil) en fond, les meubles en
// images triées par profondeur (le bas de l'objet) avec leur ombre portée, les plaques des pièces sur les murs.
import type Phaser from 'phaser';

import type { InfoObjet } from '../sprites';
import { peindreCarte } from './peinture/peindre';
import { ART } from './peinture/sols';
import { TUILE, type Carte } from './plan';

export const POLICE = '"Pixelify Sans", monospace';
const CLE_CARTE = 'carte-peinte';

export function dessinerCarte(scene: Phaser.Scene, carte: Carte): void {
  if (scene.textures.exists(CLE_CARTE)) scene.textures.remove(CLE_CARTE);
  scene.textures.addCanvas(CLE_CARTE, peindreCarte(carte));
  scene.add.image(0, 0, CLE_CARTE).setOrigin(0, 0).setScale(TUILE / ART).setDepth(-10);
}

/** Ombre portée d'un meuble : sa silhouette assombrie, décalée vers le bas à droite, posée sur le sol. */
function ombre(scene: Phaser.Scene, img: Phaser.GameObjects.Image): void {
  scene.add.image(img.x + 6, img.y + 3, img.texture.key).setOrigin(0.5, 1).setFlipX(img.flipX)
    .setTintFill(0x1a0c1e).setAlpha(0.22).setScale(1, 0.9).setDepth(-6);
}

export function poserObjets(
  scene: Phaser.Scene,
  carte: Carte,
  objets: Record<string, InfoObjet>,
): { nom: string; image: Phaser.GameObjects.Image }[] {
  const poses: { nom: string; image: Phaser.GameObjects.Image }[] = [];
  for (const o of carte.objets) {
    if (!objets[o.nom]) continue;
    const profondeur = o.auMur ? -8 : o.auSol ? -5 : o.y;
    const img = scene.add.image(o.x, o.y, `objet-${o.nom}`).setOrigin(0.5, 1).setDepth(profondeur);
    if (o.miroir) img.setFlipX(true);
    if (!o.auSol && !o.auMur) ombre(scene, img);
    poses.push({ nom: o.nom, image: img });
  }
  return poses;
}

/** Plaque de porte sur la face du mur, côté couloir : le nom du projet. */
export function poserPlaques(scene: Phaser.Scene, carte: Carte): void {
  for (const p of carte.plaques) {
    const t = scene.add.text(p.x, p.y, p.texte, { fontFamily: POLICE, fontSize: '11px', color: '#f3ead6', resolution: 3 });
    t.setOrigin(0.5).setPadding(5, 1, 5, 1).setBackgroundColor('#3a2c22').setDepth(-7);
  }
}
