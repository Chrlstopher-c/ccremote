// Responsabilité : dessiner la station dans Phaser avec le kit prélevé dans l'image de référence — bandes répétées
// (sol, mur du fond, mur bas, bord de coque), cloisons et montants, portes, hublots, tubes-sas, espace étoilé, puis les
// objets triés par profondeur. Le mur bas a la profondeur de son pied : un personnage dans la pièce passe derrière.
import type Phaser from 'phaser';

import type { Objet } from '../carte/plan';
import { CASE, COTE, type Pont, type Station } from './plan-station';

const ECHELLE = 2; // le kit est en pixels d'art, affichés ×2
export const KIT = ['sol', 'mur-fond', 'mur-fond-hublot', 'mur-fond-bouche', 'mur-bas', 'montant', 'bord', 'porte-bois',
  'sas'] as const;
export const OBJETS_STATION = ['poste', 'baie', 'biblio', 'tableau', 'plante', 'plante2', 'plante3', 'poubelle',
  'poubelle2', 'cryo-vide', 'cryo-couche', 'table-cafe', 'comptoir', 'nacelle', 'lampe'] as const;
export const POLICE = '"Pixelify Sans", monospace';

export function chargerKit(scene: Phaser.Scene): void {
  for (const n of KIT) scene.load.image(`st-${n}`, `station/${n}.png`);
  for (const n of OBJETS_STATION) scene.load.image(`st-o-${n}`, `station/objets/${n}.png`);
}

function etoiles(scene: Phaser.Scene): string {
  const cle = 'st-espace';
  if (scene.textures.exists(cle)) return cle;
  const t = scene.textures.createCanvas(cle, 256, 256);
  const ctx = t?.getContext();
  if (!t || !ctx) return cle;
  ctx.fillStyle = '#04060f';
  ctx.fillRect(0, 0, 256, 256);
  for (let k = 0; k < 90; k++) {
    ctx.fillStyle = ['#ffffff', '#cfe0ff', '#ffe7b8'][k % 3] ?? '#fff';
    ctx.globalAlpha = 0.3 + ((k * 37) % 70) / 100;
    ctx.fillRect((k * 97) % 256, (k * 53 + (k % 7) * 31) % 256, 1, 1);
  }
  t.refresh();
  return cle;
}

/** Bande du kit répétée en largeur sur [x0, x1], posée à y (haut) ; `hauteur` (px du monde) la répète aussi en
 * hauteur (le sol), sinon elle garde sa hauteur propre. */
function bande(scene: Phaser.Scene, nom: string, x0: number, x1: number, y: number, profondeur: number,
  hauteur?: number): void {
  const haut = hauteur ? hauteur / ECHELLE : scene.textures.get(`st-${nom}`).getSourceImage().height;
  scene.add.tileSprite(x0, y, (x1 - x0) / ECHELLE, haut, `st-${nom}`).setOrigin(0, 0).setScale(ECHELLE)
    .setDepth(profondeur);
}

function image(scene: Phaser.Scene, nom: string, x: number, bas: number, profondeur: number): Phaser.GameObjects.Image {
  return scene.add.image(x, bas, nom).setOrigin(0.5, 1).setScale(ECHELLE).setDepth(profondeur);
}

/** Cloison verticale (montant étiré) du haut du mur du fond jusqu'au pied du mur bas. */
function cloison(scene: Phaser.Scene, x: number, y0: number): void {
  scene.add.image(x, y0, 'st-montant').setOrigin(0.5, 0).setDisplaySize(16, COTE.coursive)
    .setDepth(y0 + COTE.coursive);
}

function plaque(scene: Phaser.Scene, p: Pont, texte: string, x: number, y: number): void {
  const couleur = `#${p.categorie.accent.toString(16).padStart(6, '0')}`;
  scene.add.text(x, y, texte, { fontFamily: POLICE, fontSize: '13px', color: '#141824', resolution: 3 })
    .setOrigin(0.5, 0).setPadding(6, 2, 6, 2).setBackgroundColor(couleur).setDepth(-9);
}

function dessinerPont(scene: Phaser.Scene, p: Pont): void {
  const y0 = p.y * CASE;
  const x0 = p.x * CASE;
  const x1 = (p.tube + 2) * CASE;
  bande(scene, 'sol', x0, x1, y0 + COTE.murFond - 20, -12, COTE.bord - COTE.murFond + 40);
  bande(scene, 'mur-fond', x0, x1, y0, -11);
  bande(scene, 'mur-bas', x0, x1, y0 + COTE.murBasHaut, y0 + COTE.coursive);
  bande(scene, 'bord', x0, x1, y0 + COTE.bord, -11);
  for (const c of p.compartiments) {
    for (let x = (c.x + 2) * CASE; x + 2 * CASE < (c.x + c.w) * CASE; x += 5 * CASE) {
      image(scene, 'st-mur-fond-hublot', x + CASE, y0 + COTE.murFond, -10);
    }
    cloison(scene, c.x * CASE - CASE / 2, y0);
    image(scene, 'st-porte-bois', (c.porte + 1) * CASE, y0 + COTE.coursive, y0 + COTE.coursive + 1);
    plaque(scene, p, c.projet, (c.x + c.w / 2) * CASE, y0 + 22);
  }
  cloison(scene, p.tube * CASE - CASE / 2, y0);
  image(scene, 'st-sas', (p.tube + 1) * CASE, y0 + COTE.coursive, y0 + COTE.coursive + 1);
  cloison(scene, x1 - 8, y0);
}

/** Tube vitré : sort sous le bord de coque du pont `a`, traverse le vide, entre par le haut du mur du fond de `b`. */
function tube(scene: Phaser.Scene, a: Pont, b: Pont): void {
  const x = a.tube * CASE;
  const y0 = a.y * CASE + COTE.bord;
  const y1 = b.y * CASE + 16;
  const g = scene.add.graphics().setDepth(-11.5);
  g.fillStyle(0x1b2a44, 0.92).fillRect(x + 4, y0, 2 * CASE - 8, y1 - y0);
  g.fillStyle(0x8fb4e0, 0.35).fillRect(x + 10, y0, 6, y1 - y0);
  g.lineStyle(4, 0x9aa3b0, 1).strokeRect(x + 4, y0, 2 * CASE - 8, y1 - y0);
  for (let y = y0 + 30; y < y1; y += 60) g.fillStyle(0x6b7380, 1).fillRect(x + 2, y, 2 * CASE - 4, 8);
}

export function dessinerStation(scene: Phaser.Scene, s: Station): void {
  const w = s.carte.largeur * CASE;
  const h = s.carte.hauteur * CASE;
  scene.add.tileSprite(0, 0, w / 2, h / 2, etoiles(scene)).setOrigin(0, 0).setScale(2).setDepth(-20);
  s.ponts.slice(1).forEach((p, i) => {
    const a = s.ponts[i];
    if (a) tube(scene, a, p);
  });
  for (const p of s.ponts) dessinerPont(scene, p);
}

export function poserObjetsStation(
  scene: Phaser.Scene,
  objets: readonly Objet[],
): { nom: string; image: Phaser.GameObjects.Image }[] {
  return objets.map((o) => {
    const img = image(scene, `st-o-${o.nom}`, o.x, o.y, o.auSol ? -5 : o.y);
    scene.add.ellipse(o.x + 4, o.y - 2, img.displayWidth * 0.8, 10, 0x05040c, 0.35).setDepth(-6);
    return { nom: o.nom, image: img };
  });
}
