// Responsabilité : charger les ressources du monde (tuiles, objets, planches des personnages exportées par `art/`)
// et créer les animations Phaser image par image, chaque image avec sa propre durée.
import type Phaser from 'phaser';

export interface PlanchePerso {
  w: number;
  h: number;
  n: number;
  seq: [number, number][];
  ancre: [number, number];
}

export interface InfoObjet {
  w: number;
  h: number;
  emprise: number;
}

export interface Ressources {
  persos: Record<string, PlanchePerso>;
  objets: Record<string, InfoObjet>;
  tuiles: Record<string, number>;
}

/** Première passe : les index JSON ; la seconde (`chargerImages`) part de leur contenu. */
export function chargerIndex(scene: Phaser.Scene): void {
  scene.load.json('persos', 'sprites/persos/persos.json');
  scene.load.json('objets', 'objets.json');
  scene.load.json('tuiles', 'tuiles.json');
}

export function chargerImages(scene: Phaser.Scene, r: Ressources): void {
  scene.load.image('tuiles', 'tuiles.png');
  for (const nom of Object.keys(r.objets)) scene.load.image(`objet-${nom}`, `objets/${nom}.png`);
  for (const [nom, p] of Object.entries(r.persos)) {
    scene.load.spritesheet(nom, `sprites/persos/${nom}.png`, { frameWidth: p.w, frameHeight: p.h });
  }
}

export function creerAnimations(scene: Phaser.Scene, persos: Record<string, PlanchePerso>): void {
  for (const [nom, p] of Object.entries(persos)) {
    scene.anims.create({
      key: nom,
      frames: p.seq.map(([frame, ms]) => ({ key: nom, frame, duration: ms })),
      frameRate: 1000,
      repeat: -1,
    });
  }
}
