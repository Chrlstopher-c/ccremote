// Responsabilité : l'ambiance lumineuse du monde selon l'heure réelle — voile de nuit (soir et nuit) et halos des
// sources de lumière (lampadaires, écrans des bureaux, terminal, distributeur), qui respirent doucement.
import Phaser from 'phaser';

import type { Carte } from './carte/plan';

const SOURCES: Record<string, { couleur: number; rayon: number; dy: number; force: number }> = {
  lampadaire: { couleur: 0xffcf7a, rayon: 110, dy: -84, force: 0.55 },
  bureau: { couleur: 0x7fd0ff, rayon: 60, dy: -66, force: 0.4 },
  crt: { couleur: 0x7cf08a, rayon: 46, dy: -40, force: 0.45 },
  distributeur: { couleur: 0xfff0d0, rayon: 56, dy: -46, force: 0.35 },
  serveur: { couleur: 0x70b8ff, rayon: 34, dy: -40, force: 0.3 },
};

/** 0 en plein jour, 1 en pleine nuit, avec crépuscule et aube progressifs. */
export function nuitDe(heure: number): number {
  if (heure >= 21 || heure < 5) return 1;
  if (heure >= 18) return (heure - 18) / 3;
  if (heure < 8) return 1 - (heure - 5) / 3;
  return 0;
}

function textureHalo(scene: Phaser.Scene): string {
  const cle = 'halo';
  if (scene.textures.exists(cle)) return cle;
  const t = scene.textures.createCanvas(cle, 128, 128);
  const ctx = t?.getContext();
  if (!t || !ctx) return cle;
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.45)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  t.refresh();
  return cle;
}

export function poserAmbiance(scene: Phaser.Scene, carte: Carte, maintenant = new Date()): void {
  const nuit = nuitDe(maintenant.getHours() + maintenant.getMinutes() / 60);
  if (nuit <= 0) return;
  const w = carte.largeur * 32;
  const h = carte.hauteur * 32;
  scene.add.rectangle(0, 0, w, h, 0x1a1640, 0.38 * nuit).setOrigin(0, 0).setDepth(90000);
  const cle = textureHalo(scene);
  for (const o of carte.objets) {
    const s = SOURCES[o.nom];
    if (!s) continue;
    const halo = scene.add.image(o.x, o.y + s.dy, cle).setDepth(90001).setBlendMode(Phaser.BlendModes.ADD);
    halo.setTint(s.couleur).setScale((s.rayon * 2) / 128).setAlpha(s.force * nuit);
    scene.tweens.add({ targets: halo, alpha: s.force * nuit * 0.8, duration: 1800 + Math.random() * 1200,
      yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
  }
  fenetres(scene, carte, cle, nuit);
}

/** Les fenêtres éclairées de la façade (celles qui donnent dehors) rayonnent sur le parvis. */
function fenetres(scene: Phaser.Scene, carte: Carte, cle: string, nuit: number): void {
  for (const f of carte.fenetres) {
    if (carte.cases[f.y + 1]?.[f.x]?.nature !== 'dehors') continue;
    scene.add.image(f.x * 32 + 16, f.y * 32 + 30, cle).setDepth(90001).setBlendMode(Phaser.BlendModes.ADD)
      .setTint(0xffd27a).setScale(1.1).setAlpha(0.45 * nuit);
  }
}
