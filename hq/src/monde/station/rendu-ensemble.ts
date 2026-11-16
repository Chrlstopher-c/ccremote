// Responsabilité : dessiner la VUE STATION — l'image d'ensemble de Chris en carte, et sur chaque compartiment attribué
// une plaque : le nom du projet et l'état réel de ses agents (rouge : t'attend, ambre : a fini, vert : au travail).
// Taper une plaque fait entrer dans la pièce ; taper la salle centrale ouvre la réunion.
import type Phaser from 'phaser';

import type { ResumeSession } from '../../donnees';
import { etatDansLeMonde } from '../lien-donnees';
import { categorieDe } from './categories';
import { attribuer, CENTRALE, ILOTS } from './ensemble';

export const ENSEMBLE = { w: 1664, h: 928 };
const POLICE = '"Pixelify Sans", monospace';

export function chargerEnsemble(scene: Phaser.Scene): void {
  scene.load.image('st-ensemble', 'station/ensemble.png');
}

interface Compte {
  travail: number;
  attend: number;
  fini: number;
}

function compter(sessions: readonly ResumeSession[]): Compte {
  const t = Date.now();
  const c: Compte = { travail: 0, attend: 0, fini: 0 };
  for (const s of sessions) {
    const e = etatDansLeMonde(s, t);
    if (e === 'bloque') c.attend += 1;
    else if (e === 'fini') c.fini += 1;
    else if (e === 'travail') c.travail += 1;
  }
  return c;
}

function pastilles(scene: Phaser.Scene, x: number, y: number, c: Compte): Phaser.GameObjects.GameObject[] {
  const liste: [number, number][] = [[c.attend, 0xff4d6a], [c.fini, 0xf0a030], [c.travail, 0x3fd08a]];
  const objets: Phaser.GameObjects.GameObject[] = [];
  let dx = 0;
  for (const [n, couleur] of liste) {
    if (!n) continue;
    objets.push(scene.add.circle(x + dx, y, 7, couleur).setStrokeStyle(2, 0x10131f));
    objets.push(scene.add.text(x + dx, y, String(n), { fontFamily: POLICE, fontSize: '10px', color: '#10131f',
      resolution: 4 }).setOrigin(0.5));
    dx += 17;
  }
  return objets;
}

function plaque(scene: Phaser.Scene, x: number, y: number, projet: string, c: Compte, entrer: () => void): void {
  const accent = categorieDe(projet).accent;
  const texte = scene.add.text(0, 0, projet, { fontFamily: POLICE, fontSize: '12px', color: '#eef2ff', resolution: 4 })
    .setOrigin(0, 0.5);
  const w = texte.width + 30 + (c.attend + c.fini + c.travail > 0 ? 50 : 0);
  const fond = scene.add.rectangle(0, 0, w, 22, 0x141a2c, 0.92).setOrigin(0, 0.5).setStrokeStyle(2, accent);
  texte.setPosition(18, 0);
  const point = scene.add.rectangle(7, 0, 6, 6, accent).setOrigin(0, 0.5);
  scene.add.container(x - w / 2, y - 26, [fond, point, texte,
    ...pastilles(scene, texte.width + 30, 0, c)]).setDepth(10).setSize(w, 22);
  scene.add.triangle(x, y - 13, -5, 0, 5, 0, 0, 7, accent).setDepth(10);
  fond.setInteractive({ useHandCursor: true }).on('pointerup', entrer);
}

export function dessinerEnsemble(
  scene: Phaser.Scene,
  sessions: readonly ResumeSession[],
  entrer: (projet: string) => void,
  reunion: () => void,
): void {
  scene.add.image(0, 0, 'st-ensemble').setOrigin(0, 0).setDepth(-20);
  for (const i of ILOTS) {
    scene.add.text(i.x * ENSEMBLE.w, i.y * ENSEMBLE.h, i.nom, { fontFamily: POLICE, fontSize: '10px', color: '#c9d2ea',
      resolution: 4 }).setOrigin(0.5).setAlpha(0.7).setDepth(5);
  }
  for (const a of attribuer(sessions.map((s) => s.projet.nom))) {
    const siennes = sessions.filter((s) => s.projet.nom === a.projet);
    plaque(scene, a.emplacement.x * ENSEMBLE.w, a.emplacement.y * ENSEMBLE.h, a.projet, compter(siennes),
      () => entrer(a.projet));
  }
  const c = { x: CENTRALE.x * ENSEMBLE.w, y: CENTRALE.y * ENSEMBLE.h };
  const centre = scene.add.text(c.x, c.y - 52, 'Salle centrale · réunion', { fontFamily: POLICE, fontSize: '12px',
    color: '#5fe0ff', backgroundColor: '#0d1424', padding: { x: 6, y: 3 }, resolution: 4 }).setOrigin(0.5).setDepth(10);
  centre.setInteractive({ useHandCursor: true }).on('pointerup', reunion);
}
