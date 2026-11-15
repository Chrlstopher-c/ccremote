// Responsabilité : la scène principale du monde — construit la carte à partir des projets, y fait vivre un Clawd par
// session et le perso de Chris (clic pour marcher, ZQSD / WASD / flèches), caméra qui suit Chris, molette pour zoomer.
import Phaser from 'phaser';

import { grilleDe, type Grille } from './carte/chemin';
import { construireCarte, TUILE, type Carte } from './carte/plan';
import { dessinerCarte, poserObjets, poserPlaques } from './carte/rendu-carte';
import { Agent } from './persos/agent';
import { Marcheur } from './persos/marcheur';
import { ouvrir, type Panneau } from '../ui/bus';
import type { MagasinMonde, ResumeSession } from '../donnees';
import { cleSessions, etatDansLeMonde, sessionsDuMonde } from './lien-donnees';
import { chargerImages, chargerIndex, creerAnimations, type Ressources } from './sprites';

export class SceneMonde extends Phaser.Scene {
  private r!: Ressources;
  private carte!: Carte;
  private grille!: Grille;
  private chris!: Marcheur;
  private agents = new Map<string, Agent>();
  private cle = '';
  private touches: Record<string, Phaser.Input.Keyboard.Key> | null = null;

  constructor() {
    super('monde');
  }

  preload(): void {
    chargerIndex(this);
  }

  create(): void {
    this.r = {
      persos: this.cache.json.get('persos'),
      objets: this.cache.json.get('objets'),
      tuiles: this.cache.json.get('tuiles'),
    };
    chargerImages(this, this.r);
    this.load.once('complete', () => this.demarrer());
    this.load.start();
  }

  private demarrer(): void {
    creerAnimations(this, this.r.persos);
    const magasin = this.registry.get('magasin') as MagasinMonde; // posé par main.ts avant le premier rendu
    const sessions = sessionsDuMonde(magasin.lire());
    this.cle = cleSessions(sessions);
    this.carte = construireCarte(sessions.map((s) => s.projet.nom));
    this.grille = grilleDe(this.carte, this.r.objets);
    dessinerCarte(this, this.carte, this.r.tuiles);
    const poses = poserObjets(this, this.carte, this.r.objets);
    poserPlaques(this, this.carte);
    sessions.forEach((s, i) => {
      const poste = this.carte.postes[i];
      if (poste) this.agents.set(s.id, new Agent(this, poste, this.carte, this.r.persos));
    });
    const retour = this.registry.get('position-chris') as { x: number; y: number } | undefined;
    this.chris = new Marcheur(this, 'chris', this.r.persos, retour ?? this.carte.depart, 110);
    this.installerControles();
    this.rendreInteractifs(poses, magasin);
    this.installerCamera();
    this.suivreSessions(magasin);
  }

  private installerControles(): void {
    const kb = this.input.keyboard;
    if (kb) {
      // addKeys renvoie un objet indexé par les noms demandés
      this.touches = kb.addKeys('Z,Q,S,D,W,A,UP,DOWN,LEFT,RIGHT') as Record<string, Phaser.Input.Keyboard.Key>;
    }
    this.input.on('pointerup', (p: Phaser.Input.Pointer, cibles: unknown[]) => {
      if (cibles.length || p.getDistance() > 6) return;
      this.chris.allerA(this.grille, { x: p.worldX, y: p.worldY });
    });
    for (const [id, a] of this.agents) {
      a.corps.sprite.on('pointerup', () => {
        ouvrir({ type: 'agent', sessionId: id });
        const d = a.corps.position;
        this.chris.allerA(this.grille, { x: d.x, y: d.y + 30 }, () => {
          this.chris.sens = 'haut';
          this.chris.poser();
        });
      });
    }
  }

  private installerCamera(): void {
    const cam = this.cameras.main;
    cam.setBounds(0, 0, this.carte.largeur * TUILE, this.carte.hauteur * TUILE);
    // téléphone : on recule un peu la caméra pour voir une pièce entière
    const zoom = Number(new URLSearchParams(location.search).get('zoom')) || (window.innerWidth < 760 ? 1.25 : 2);
    cam.setZoom(zoom).startFollow(this.chris.sprite, true, 0.12, 0.12);
    const vue = new URLSearchParams(location.search).get('vue')?.split(',').map(Number);
    if (vue?.length === 2) cam.stopFollow().centerOn(vue[0] ?? 0, vue[1] ?? 0); // capture de contrôle
    cam.setRoundPixels(true);
    this.input.on('wheel', (_p: unknown, _o: unknown, _dx: number, dy: number) => {
      cam.setZoom(Phaser.Math.Clamp(cam.zoom * (dy > 0 ? 0.9 : 1.1), 0.7, 4));
    });
  }

  /** Les meubles utiles s'ouvrent au clic : terminal (vieux poste), fichiers (étagères), réunion (table). Chris marche
   * jusqu'au meuble pendant que le panneau s'ouvre. */
  private rendreInteractifs(poses: { nom: string; image: Phaser.GameObjects.Image }[], magasin: MagasinMonde): void {
    const contexte = (): { machine: string; cwd: string } => {
      const e = magasin.lire();
      const s = sessionsDuMonde(e).at(-1);
      return { machine: s?.machine ?? e.machines[0]?.id ?? '', cwd: s?.cwd ?? e.machines[0]?.racines[0] ?? '/' };
    };
    const panneaux: Record<string, () => Panneau> = {
      crt: () => ({ type: 'terminal', ...contexte(), titre: 'Salle serveurs' }),
      serveur: () => ({ type: 'terminal', ...contexte(), titre: 'Salle serveurs' }),
      etagere: () => {
        const c = contexte();
        return { type: 'fichiers', machine: c.machine, chemin: c.cwd };
      },
      table: () => ({ type: 'reunion' }),
    };
    for (const { nom, image } of poses) {
      const panneau = panneaux[nom];
      if (!panneau) continue;
      image.setInteractive({ useHandCursor: true, pixelPerfect: true });
      image.on('pointerup', () => {
        ouvrir(panneau());
        this.chris.allerA(this.grille, { x: image.x, y: image.y + 24 });
      });
    }
  }

  /** Le bâtiment suit les sessions : une session de plus ou de moins reconstruit la carte (Chris reste où il est),
   * un changement d'état fait bouger le Clawd concerné ; l'inactivité dépend du temps, d'où un recalcul périodique. */
  private suivreSessions(magasin: MagasinMonde): void {
    const appliquer = (sessions: ResumeSession[]): void => {
      if (cleSessions(sessions) !== this.cle) {
        this.registry.set('position-chris', this.chris.position);
        this.scene.restart();
        return;
      }
      const maintenant = Date.now();
      for (const s of sessions) {
        const agent = this.agents.get(s.id);
        const etat = etatDansLeMonde(s, maintenant);
        if (agent) agent.changerEtat(etat, this.grille);
      }
    };
    appliquer(sessionsDuMonde(magasin.lire()));
    const fin = magasin.abonner((e) => sessionsDuMonde(e), (s) => appliquer(s), (a, b) => a.length === b.length &&
      a.every((s, i) => s === b[i]));
    const minuteur = this.time.addEvent({ delay: 20_000, loop: true,
      callback: () => appliquer(sessionsDuMonde(magasin.lire())) });
    this.events.once('shutdown', () => {
      fin();
      minuteur.remove();
      this.agents.clear();
    });
  }

  update(_t: number, dt: number): void {
    if (!this.chris) return;
    const k = this.touches;
    if (k) {
      const vx = (k.D?.isDown || k.RIGHT?.isDown ? 1 : 0) - (k.Q?.isDown || k.A?.isDown || k.LEFT?.isDown ? 1 : 0);
      const vy = (k.S?.isDown || k.DOWN?.isDown ? 1 : 0) - (k.Z?.isDown || k.W?.isDown || k.UP?.isDown ? 1 : 0);
      if (vx || vy || (!this.chris.enMarche && this.chris.pose.includes('marche'))) {
        this.chris.pousser(this.grille, vx, vy, dt);
      }
    }
    this.chris.miseAJour(dt);
    for (const a of this.agents.values()) a.miseAJour(dt, this.time.now);
  }
}
