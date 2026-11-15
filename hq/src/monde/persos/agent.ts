// Responsabilité : un agent (une session Claude Code) incarné par un Clawd qui vit dans le bâtiment selon son état —
// au travail il est assis à son bureau, de dos, et tape ; fini ou bloqué il pivote sur sa chaise vers la pièce et
// attend Chris ; inactif il se lève et sort fumer devant l'entrée — avec sa bulle au-dessus de la tête.
import type Phaser from 'phaser';

import type { Grille, PointMonde } from '../carte/chemin';
import { POLICE } from '../carte/rendu-carte';
import type { Carte, Poste } from '../carte/plan';
import type { PlanchePerso } from '../sprites';
import { Marcheur } from './marcheur';

export type EtatMonde = 'travail' | 'fini' | 'bloque' | 'inactive';

const BULLES: Record<EtatMonde, { texte: string; fond: number; encre: string }> = {
  bloque: { texte: '!', fond: 0xff4d6a, encre: '#ffffff' },
  fini: { texte: '✓', fond: 0x8fdcb0, encre: '#173a26' },
  travail: { texte: '…', fond: 0xf6f1e7, encre: '#3b2a1a' },
  inactive: { texte: 'z', fond: 0xc9c2d6, encre: '#3b3350' },
};

// Décalages (px) entre le pied de la chaise et les pieds de Clawd assis : de dos il est posé sur l'assise, de face
// un peu plus bas (ses pattes pendent devant l'assise).
const ASSIS_DOS = -34;
const ASSIS_FACE = -28;
const ABORD = 16; // où il se lève / arrive, juste devant la chaise

export class Agent {
  readonly corps: Marcheur;
  private readonly bulle: Phaser.GameObjects.Container;
  private readonly clignote: Phaser.Tweens.Tween;
  private readonly assise: Phaser.GameObjects.Image;
  private readonly dossier: Phaser.GameObjects.Image;
  etat: EtatMonde | null = null;

  constructor(
    private readonly scene: Phaser.Scene,
    readonly poste: Poste,
    private readonly carte: Carte,
    planches: Record<string, PlanchePerso>,
  ) {
    const { x, y } = poste.siege;
    // toile commune des deux pièces (art/meubles.py) : le sol avant de la chaise est à 72 px sur 76
    this.assise = scene.add.image(x, y, 'objet-chaise-assise').setOrigin(0.5, 72 / 76);
    this.dossier = scene.add.image(x, y, 'objet-chaise-dossier').setOrigin(0.5, 72 / 76);
    this.corps = new Marcheur(scene, 'clawd', planches, { x, y: y + ABORD }, 70);
    this.bulle = scene.add.container(0, 0);
    this.clignote = scene.tweens.add({ targets: this.bulle, alpha: 0.2, duration: 360, yoyo: true, repeat: -1,
      ease: 'Steps(2)', paused: true });
    this.corps.sprite.setInteractive({ useHandCursor: true });
    this.chaise('libre');
  }

  /** Ordre de dessin chaise / Clawd : de dos le dossier passe devant lui ; tourné vers la pièce, toute la chaise est
   * derrière lui (il est assis sur le bord, pattes pendantes devant l'assise). */
  private chaise(ordre: 'dos' | 'face' | 'libre'): void {
    const y = this.poste.siege.y;
    this.assise.setDepth(y - 1);
    this.dossier.setDepth(ordre === 'dos' ? y + 1 : ordre === 'face' ? y - 1 : y - 0.5);
  }

  private sAsseoir(face: boolean): void {
    const { x, y } = this.poste.siege;
    const anim = !face ? 'clawd-assis-frappe' : this.etat === 'bloque' ? 'clawd-assis-question' : 'clawd-assis-face';
    this.corps.sens = face ? 'bas' : 'haut';
    this.corps.asseoir(x, y + (face ? ASSIS_FACE : ASSIS_DOS), y, anim);
    this.chaise(face ? 'face' : 'dos');
  }

  private allerSAsseoir(grille: Grille, face: boolean): void {
    if (this.corps.estAssis) return this.sAsseoir(face);
    const abord = { x: this.poste.siege.x, y: this.poste.siege.y + ABORD };
    if (!this.corps.allerA(grille, abord, () => this.sAsseoir(face))) this.sAsseoir(face);
  }

  /** null : la session est éteinte — le bureau reste vide, la chaise rangée. */
  changerEtat(etat: EtatMonde | null, grille: Grille): void {
    if (etat === this.etat) return;
    this.etat = etat;
    this.corps.sprite.setVisible(etat !== null);
    this.dessinerBulle();
    if (etat === null) {
      this.corps.lever(this.poste.siege.x, this.poste.siege.y + ABORD);
      this.chaise('libre');
      return;
    }
    if (etat === 'travail') return this.allerSAsseoir(grille, false);
    if (etat === 'fini' || etat === 'bloque') return this.allerSAsseoir(grille, true);
    this.corps.lever(this.poste.siege.x, this.poste.siege.y + ABORD);
    this.chaise('libre');
    const fumoir = this.carte.lieux.fumoir;
    const p: PointMonde = { x: fumoir.x + (Math.random() - 0.5) * 50, y: fumoir.y + Math.random() * 20 };
    const posee = (): void => {
      this.corps.sens = 'bas';
      this.corps.poser('clawd-clope'); // la pause clope validée par Chris, devant l'entrée
    };
    if (!this.corps.allerA(grille, p, posee)) posee();
  }

  private dessinerBulle(): void {
    this.bulle.removeAll(true);
    if (!this.etat) return;
    const b = BULLES[this.etat];
    const g = this.scene.add.graphics();
    g.fillStyle(0x2b2140, 1).fillRoundedRect(-11, -24, 22, 20, 5);
    g.fillStyle(b.fond, 1).fillRoundedRect(-9, -22, 18, 16, 4);
    g.fillStyle(0x2b2140, 1).fillTriangle(-4, -4, 4, -4, 0, 1);
    const t = this.scene.add.text(0, -14, b.texte, { fontFamily: POLICE, fontSize: '13px', color: b.encre,
      fontStyle: 'bold', resolution: 3 }).setOrigin(0.5);
    this.bulle.add([g, t]);
    if (this.etat === 'bloque') this.clignote.resume();
    else {
      this.clignote.pause();
      this.bulle.setAlpha(1);
    }
  }

  miseAJour(dtMs: number, temps: number): void {
    this.corps.miseAJour(dtMs);
    const s = this.corps.sprite;
    const flotte = this.etat === 'bloque' ? 0 : Math.sin(temps / 450) * 1.5;
    this.bulle.setPosition(s.x, s.y - 46 + flotte).setDepth(100000);
  }
}
