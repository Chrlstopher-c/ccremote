// Responsabilité : dessiner la VUE PIÈCE dans Phaser — l'image de la pièce meublée (rendue par le modèle à partir de
// l'image StockIOP de Chris) en fond, lissée pour garder sa finesse ; son mur avant redessiné par-dessus à la
// profondeur de son pied (un personnage dans la pièce passe derrière) ; le nom du projet à la place de l'enseigne ; et
// des zones invisibles sur les meubles qui s'ouvrent au clic.
import Phaser from 'phaser';

import { DOSSIERS, ECHELLE_FOND, ENSEIGNE, FOND, MEUBLES, relatif, type Zone } from './piece';

export const POLICE = '"Pixelify Sans", monospace';

// Le mur avant de la pièce dans l'image (relatif) : redessiné au-dessus des personnages qui sont dans la pièce.
const MUR_AVANT: Zone = { x0: 0.18, y0: 0.462, x1: 0.71, y1: 0.625 };

/** Catégories qui ont leur propre pièce (variante rendue par le modèle, mêmes places que la pièce de référence) ;
 * les autres prennent la pièce StockIOP. */
export const PIECES_PAR_CATEGORIE: readonly string[] = ['clients', 'agents', 'labos', 'apps', 'jeux'];

const clePiece = (categorie: string): string =>
  PIECES_PAR_CATEGORIE.includes(categorie) ? `st-piece-${categorie}` : 'st-piece';

export function chargerPiece(scene: Phaser.Scene): void {
  scene.load.image('st-piece', 'station/piece.png');
  for (const c of PIECES_PAR_CATEGORIE) scene.load.image(`st-piece-${c}`, `station/piece-${c}.png`);
  for (const b of ['question', 'fini', 'erreur']) scene.load.image(`st-bulle-${b}`, `station/bulles/${b}.png`);
}

/** Un morceau du fond redessiné par-dessus à la profondeur de son pied (mur avant, dossier de chaise). */
function devant(scene: Phaser.Scene, cle: string, z: Zone, decalage = 0): void {
  const pied = relatif(0, z.y1).y + decalage;
  const img = scene.add.image(0, 0, cle).setOrigin(0, 0).setScale(ECHELLE_FOND).setDepth(pied);
  img.setCrop(z.x0 * FOND.w, z.y0 * FOND.h, (z.x1 - z.x0) * FOND.w, (z.y1 - z.y0) * FOND.h);
}

/** Le nom du projet sur une plaque accrochée au mur (fond sombre, liseré de la couleur de sa catégorie) ; sur la
 * pièce de référence, un aplat crème couvre d'abord l'enseigne « StockIOP » peinte dans l'image. */
function enseigne(scene: Phaser.Scene, cle: string, projet: string, accent: number): void {
  const a = relatif(ENSEIGNE.x0, ENSEIGNE.y0);
  const b = relatif(ENSEIGNE.x1, ENSEIGNE.y1);
  if (cle === 'st-piece') scene.add.rectangle(a.x, a.y, b.x - a.x, b.y - a.y, 0xbea78c).setOrigin(0, 0).setDepth(-19);
  const y = (a.y + b.y) / 2;
  const texte = scene.add.text(a.x + 22, y, projet, { fontFamily: POLICE, fontSize: '14px', color: '#eef2ff',
    resolution: 4 }).setOrigin(0, 0.5).setDepth(-17);
  scene.add.rectangle(a.x, y, texte.width + 32, 24, 0x161c2e, 0.95).setOrigin(0, 0.5).setStrokeStyle(2, accent).setDepth(-18);
  scene.add.rectangle(a.x + 8, y, 8, 8, accent).setOrigin(0, 0.5).setDepth(-17);
}

export function dessinerPiece(scene: Phaser.Scene, projet: string, categorie: string, accent: number): Phaser.GameObjects.Zone[] {
  const cle = clePiece(categorie);
  scene.textures.get(cle).setFilter(Phaser.Textures.FilterMode.LINEAR);
  scene.add.image(0, 0, cle).setOrigin(0, 0).setScale(ECHELLE_FOND).setDepth(-20);
  devant(scene, cle, MUR_AVANT);
  for (const d of DOSSIERS) devant(scene, cle, d, 2);
  enseigne(scene, cle, projet, accent);
  return MEUBLES.map((m) => {
    const a = relatif(m.x0, m.y0);
    const b = relatif(m.x1, m.y1);
    return scene.add.zone(a.x, a.y, b.x - a.x, b.y - a.y).setOrigin(0, 0).setName(m.nom);
  });
}
