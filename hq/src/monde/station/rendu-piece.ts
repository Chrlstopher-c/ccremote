// Responsabilité : dessiner la VUE PIÈCE dans Phaser — l'image de la pièce meublée (rendue par le modèle à partir de
// l'image StockIOP de Chris) en fond, lissée pour garder sa finesse ; son mur avant redessiné par-dessus à la
// profondeur de son pied (un personnage dans la pièce passe derrière) ; le nom du projet à la place de l'enseigne ; et
// des zones invisibles sur les meubles qui s'ouvrent au clic.
import Phaser from 'phaser';

import { DOSSIERS, ECHELLE_FOND, ENSEIGNE, FOND, MEUBLES, relatif, type Zone } from './piece';

export const POLICE = '"Pixelify Sans", monospace';

// Le mur avant de la pièce dans l'image (relatif) : redessiné au-dessus des personnages qui sont dans la pièce.
const MUR_AVANT: Zone = { x0: 0.18, y0: 0.462, x1: 0.71, y1: 0.625 };

export function chargerPiece(scene: Phaser.Scene): void {
  scene.load.image('st-piece', 'station/piece.png');
  for (const b of ['question', 'fini', 'erreur']) scene.load.image(`st-bulle-${b}`, `station/bulles/${b}.png`);
}

/** Un morceau du fond redessiné par-dessus à la profondeur de son pied (mur avant, dossier de chaise). */
function devant(scene: Phaser.Scene, z: Zone, decalage = 0): void {
  const pied = relatif(0, z.y1).y + decalage;
  const img = scene.add.image(0, 0, 'st-piece').setOrigin(0, 0).setScale(ECHELLE_FOND).setDepth(pied);
  img.setCrop(z.x0 * FOND.w, z.y0 * FOND.h, (z.x1 - z.x0) * FOND.w, (z.y1 - z.y0) * FOND.h);
}

/** Le nom du projet peint sur le mur, sur un panneau de la couleur du mur qui recouvre l'enseigne d'origine. */
function enseigne(scene: Phaser.Scene, projet: string, accent: number): void {
  const a = relatif(ENSEIGNE.x0, ENSEIGNE.y0);
  const b = relatif(ENSEIGNE.x1, ENSEIGNE.y1);
  scene.add.rectangle(a.x, a.y, b.x - a.x, b.y - a.y, 0xbea78c).setOrigin(0, 0).setDepth(-19);
  const h = b.y - a.y;
  scene.add.rectangle(a.x + 4, a.y + h / 2, h * 0.6, h * 0.6, accent).setOrigin(0, 0.5).setStrokeStyle(2, 0x23293b)
    .setDepth(-18);
  scene.add.text(a.x + h * 0.85, a.y + h / 2, projet, { fontFamily: POLICE, fontSize: '17px', color: '#252b3c',
    resolution: 4 }).setOrigin(0, 0.5).setDepth(-18);
}

export function dessinerPiece(scene: Phaser.Scene, projet: string, accent: number): Phaser.GameObjects.Zone[] {
  scene.textures.get('st-piece').setFilter(Phaser.Textures.FilterMode.LINEAR);
  scene.add.image(0, 0, 'st-piece').setOrigin(0, 0).setScale(ECHELLE_FOND).setDepth(-20);
  devant(scene, MUR_AVANT);
  for (const d of DOSSIERS) devant(scene, d, 2);
  enseigne(scene, projet, accent);
  return MEUBLES.map((m) => {
    const a = relatif(m.x0, m.y0);
    const b = relatif(m.x1, m.y1);
    return scene.add.zone(a.x, a.y, b.x - a.x, b.y - a.y).setOrigin(0, 0).setName(m.nom);
  });
}
