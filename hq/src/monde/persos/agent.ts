// Responsabilité : un agent (une session Claude Code) incarné par un Clawd qui vit dans le bâtiment selon son état —
// au travail il est assis à son bureau, de dos, et tape ; fini ou bloqué il pivote sur sa chaise vers la pièce et
// attend Chris ; inactif il se lève et sort fumer devant l'entrée — avec sa bulle au-dessus de la tête.
import type Phaser from 'phaser';

import type { Grille, PointMonde } from '../carte/chemin';
import type { Carte, Poste } from '../carte/plan';
import type { PlanchePerso } from '../sprites';
import { Marcheur } from './marcheur';

export type EtatMonde = 'travail' | 'fini' | 'bloque' | 'inactive';


// Décalages (px) entre le pied de la chaise et les pieds de Clawd assis : de dos il est posé sur l'assise, de face
// un peu plus bas (ses pattes pendent devant l'assise).
const ASSIS_DOS = -24; // le corps s'enfonce dans la chaise : seule la tête dépasse du dossier
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
    // le poste de la station a déjà sa chaise : celles-ci ne servent plus qu'à l'ordre de dessin (invisibles)
    this.assise = scene.add.image(x, y, 'objet-chaise-assise').setOrigin(0.5, 72 / 76).setVisible(false);
    this.dossier = scene.add.image(x, y, 'objet-chaise-dossier').setOrigin(0.5, 72 / 76).setVisible(false);
    this.corps = new Marcheur(scene, 'clawd', planches, { x, y: y + ABORD }, 70);
    this.bulle = scene.add.container(0, 0);
    this.clignote = scene.tweens.add({ targets: this.bulle, alpha: 0.55, duration: 700, yoyo: true, repeat: -1,
      ease: 'Sine.easeInOut', paused: true });
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

  /** Il t'attend ou a fini : il se lève et se tient debout devant son poste, face à la pièce (comme dans les images
   * de référence), plutôt que de pivoter sur sa chaise. */
  private allerDebout(grille: Grille, etat: 'fini' | 'bloque'): void {
    const { x, y } = this.poste.debout;
    this.corps.lever(this.poste.siege.x, y);
    this.chaise('libre');
    const pose = (): void => {
      this.corps.sens = 'bas';
      this.corps.poser(etat === 'bloque' ? 'clawd-question' : 'clawd-content');
    };
    if (!this.corps.allerA(grille, { x, y }, pose)) pose();
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
    if (etat === 'fini' || etat === 'bloque') return this.allerDebout(grille, etat);
    this.corps.lever(this.poste.siege.x, this.poste.siege.y + ABORD);
    this.chaise('libre');
    const fumoir = this.carte.lieux.fumoir;
    const p: PointMonde = { x: fumoir.x + (Math.random() - 0.5) * 50, y: fumoir.y + Math.random() * 20 };
    const posee = (): void => {
      this.corps.sens = 'bas';
      this.corps.poser('clawd-repos'); // en pause au café de la pièce
    };
    if (!this.corps.allerA(grille, p, posee)) posee();
  }

  /** Bulle dessinée dans le style des images de référence (planche ChatGPT) : « ? » il t'attend, « ✓ » il a fini.
   * Au travail ou en pause : pas de bulle, le geste suffit. */
  private dessinerBulle(): void {
    this.bulle.removeAll(true);
    const cle = this.etat === 'bloque' ? 'st-bulle-question' : this.etat === 'fini' ? 'st-bulle-fini' : null;
    if (!cle) return;
    this.bulle.add(this.scene.add.image(0, 0, cle).setOrigin(0.5, 1).setScale(0.6));
    if (this.etat === 'bloque') this.clignote.resume();
    else {
      this.clignote.pause();
      this.bulle.setAlpha(1);
    }
  }

  miseAJour(dtMs: number, temps: number): void {
    this.corps.miseAJour(dtMs);
    const s = this.corps.sprite;
    const flotte = Math.sin(temps / 450) * 1.5;
    this.bulle.setPosition(s.x, s.y - 40 + flotte).setDepth(100000);
  }
}
