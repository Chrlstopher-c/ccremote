// Responsabilité : un personnage qui vit dans la carte (Clawd ou Chris) — sprite ancré aux pieds, ombre portée,
// profondeur selon sa position, marche le long d'un chemin avec l'animation de la bonne direction, puis une pose.
import type Phaser from 'phaser';

import { chemin, type Grille, type PointMonde } from '../carte/chemin';
import { TUILE } from '../carte/plan';
import type { PlanchePerso } from '../sprites';

export type Sens = 'bas' | 'haut' | 'gauche' | 'droite';

export class Marcheur {
  readonly sprite: Phaser.GameObjects.Sprite;
  private readonly ombre: Phaser.GameObjects.Ellipse;
  private trajet: PointMonde[] = [];
  private arrivee: (() => void) | null = null;
  sens: Sens = 'bas';
  pose = '';
  private assis: { profondeur: number } | null = null;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly prefixe: 'clawd' | 'chris',
    private readonly planches: Record<string, PlanchePerso>,
    depart: PointMonde,
    private readonly vitesse: number,
  ) {
    const largeurOmbre = prefixe === 'clawd' ? 30 : 24;
    this.ombre = scene.add.ellipse(depart.x, depart.y, largeurOmbre, 9, 0x1a1020, 0.32);
    this.sprite = scene.add.sprite(depart.x, depart.y, this.repos());
    this.placerAncre(this.repos());
    this.poser(this.repos());
  }

  get position(): PointMonde {
    return { x: this.sprite.x, y: this.sprite.y };
  }

  get enMarche(): boolean {
    return this.trajet.length > 0;
  }

  private repos(): string {
    if (this.prefixe === 'clawd') return this.sens === 'haut' ? 'clawd-repos-dos' : 'clawd-repos';
    return `chris-repos-${this.sens}`;
  }

  private placerAncre(anim: string): void {
    const p = this.planches[anim];
    if (p) this.sprite.setOrigin(p.ancre[0] / p.w, p.ancre[1] / p.h);
  }

  /** Joue une animation fixe (frappe, café…) ; vide = la pose de repos de la direction courante. */
  poser(anim = ''): void {
    const nom = anim || this.repos();
    if (this.pose === nom || !this.planches[nom]) return;
    this.pose = nom;
    this.placerAncre(nom);
    this.sprite.play(nom);
  }

  allerA(grille: Grille, vers: PointMonde, arrivee?: () => void): boolean {
    const t = chemin(grille, this.position, vers);
    if (!t) return false;
    this.trajet = t;
    this.arrivee = arrivee ?? null;
    return true;
  }

  arreter(): void {
    this.trajet = [];
    this.poser();
  }

  /** S'installe sur un siège : position et profondeur imposées (entre l'assise et le dossier), plus d'ombre. */
  asseoir(x: number, y: number, profondeur: number, anim: string): void {
    this.trajet = [];
    this.assis = { profondeur };
    this.sprite.setPosition(x, y);
    this.ombre.setVisible(false);
    this.poser(anim);
  }

  lever(x: number, y: number): void {
    if (!this.assis) return;
    this.assis = null;
    this.sprite.setPosition(x, y);
    this.ombre.setVisible(true);
    this.poser();
  }

  get estAssis(): boolean {
    return this.assis !== null;
  }

  miseAJour(dtMs: number): void {
    if (this.assis) {
      this.sprite.setDepth(this.assis.profondeur);
      return;
    }
    const cible = this.trajet[0];
    if (cible) this.avancer(cible, dtMs);
    this.sprite.setDepth(this.sprite.y);
    this.ombre.setPosition(this.sprite.x, this.sprite.y - 1).setDepth(this.sprite.y - 0.5);
  }

  private avancer(cible: PointMonde, dtMs: number): void {
    const dx = cible.x - this.sprite.x;
    const dy = cible.y - this.sprite.y;
    const d = Math.hypot(dx, dy);
    const pas = (this.vitesse * dtMs) / 1000;
    if (d <= pas) {
      this.sprite.setPosition(cible.x, cible.y);
      this.trajet.shift();
      if (!this.trajet.length) this.finir();
      return;
    }
    this.sprite.setPosition(this.sprite.x + (dx / d) * pas, this.sprite.y + (dy / d) * pas);
    this.sens = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'droite' : 'gauche') : dy > 0 ? 'bas' : 'haut';
    this.poser(`${this.prefixe}-marche-${this.sens}`);
  }

  private finir(): void {
    this.pose = '';
    this.poser();
    const f = this.arrivee;
    this.arrivee = null;
    f?.();
  }

  /** Marche manuelle (clavier) : déplacement direct, bloqué par la grille. */
  pousser(grille: Grille, vx: number, vy: number, dtMs: number): void {
    this.trajet = [];
    if (!vx && !vy) {
      if (this.pose.includes('marche')) this.poser();
      return;
    }
    const n = Math.hypot(vx, vy);
    const pas = (this.vitesse * dtMs) / 1000;
    const nx = this.sprite.x + (vx / n) * pas;
    const ny = this.sprite.y + (vy / n) * pas;
    const libre = (x: number, y: number): boolean =>
      grille.libre[Math.floor((y - 2) / TUILE)]?.[Math.floor(x / TUILE)] === true;
    if (libre(nx, this.sprite.y)) this.sprite.x = nx;
    if (libre(this.sprite.x, ny)) this.sprite.y = ny;
    this.sens = Math.abs(vx) > Math.abs(vy) ? (vx > 0 ? 'droite' : 'gauche') : vy > 0 ? 'bas' : 'haut';
    this.poser(`${this.prefixe}-marche-${this.sens}`);
  }
}
