// Responsabilité : la scène du monde, en deux vues tirées des images de Chris — la VUE STATION (sa vue d'ensemble en
// anneaux : chaque projet épinglé sur son compartiment avec l'état de ses agents ; glisser pour se déplacer, molette
// ou pincer pour zoomer) et la VUE PIÈCE (l'intérieur d'un compartiment : ses agents à leur poste, Chris qui marche).
// Taper une plaque fait entrer dans la pièce ; Échap ou « ← Station » ramène à la station.
import Phaser from 'phaser';

import { grilleDe, type Grille } from './carte/chemin';
import type { Carte } from './carte/plan';
import { Agent } from './persos/agent';
import { Marcheur } from './persos/marcheur';
import { ecouterPanneau, ouvrir, type Panneau } from '../ui/bus';
import type { MagasinMonde, ResumeSession } from '../donnees';
import { cleSessions, etatDansLeMonde, sessionsDuMonde } from './lien-donnees';
import { chargerImages, chargerIndex, creerAnimations, type Ressources } from './sprites';
import { erreurChargement, etapeChargement, finChargement } from '../ui/chargement';
import { categorieDe } from './station/categories';
import { chargerEnsemble, dessinerEnsemble, ENSEMBLE } from './station/rendu-ensemble';
import { construirePiece, ECHELLE_FOND, FOND } from './station/piece';
import { chargerPiece, dessinerPiece } from './station/rendu-piece';
import { activerGlisserZoomer } from './station/camera';

const VUE = 'vue'; // clé du registre : 'station' ou le nom du projet dont on visite la pièce

export class SceneMonde extends Phaser.Scene {
  private r!: Ressources;
  private carte: Carte | null = null;
  private grille: Grille | null = null;
  private chris: Marcheur | null = null;
  private agents = new Map<string, Agent>();
  private touches: Record<string, Phaser.Input.Keyboard.Key> | null = null;

  constructor() {
    super('monde');
  }

  preload(): void {
    etapeChargement('description du monde…');
    this.load.on('loaderror', (f: Phaser.Loader.File) => erreurChargement(`fichier introuvable : ${f.url}`));
    chargerIndex(this);
    chargerEnsemble(this);
    chargerPiece(this);
  }

  create(): void {
    this.r = { persos: this.cache.json.get('persos'), objets: this.cache.json.get('objets') };
    chargerImages(this, this.r);
    this.load.on('progress', (p: number) => etapeChargement(`images ${Math.round(p * 100)} %`));
    this.load.once('complete', () => {
      etapeChargement('construction du monde…');
      try {
        this.demarrer();
        finChargement();
      } catch (err) {
        erreurChargement(`monde : ${String(err)}`);
      }
    });
    this.load.start();
  }

  private get magasin(): MagasinMonde {
    return this.registry.get('magasin') as MagasinMonde; // posé par main.ts avant le premier rendu
  }

  private demarrer(): void {
    if (!this.anims.exists('clawd-repos')) creerAnimations(this, this.r.persos);
    const vue = (this.registry.get(VUE) as string | undefined) ?? new URLSearchParams(location.search).get('piece') ?? 'station';
    const sessions = sessionsDuMonde(this.magasin.lire());
    if (vue === 'station') this.demarrerStation(sessions);
    else this.demarrerPiece(vue, sessions.filter((s) => s.projet.nom === vue));
    this.suivreSessions(vue);
  }

  private aller(vue: string): void {
    this.registry.set(VUE, vue);
    this.scene.restart();
  }

  private demarrerStation(sessions: ResumeSession[]): void {
    dessinerEnsemble(this, sessions, (projet) => this.aller(projet), () => ouvrir({ type: 'reunion' }));
    activerGlisserZoomer(this, ENSEMBLE.w, ENSEMBLE.h);
  }

  private demarrerPiece(projet: string, sessions: ResumeSession[]): void {
    this.carte = construirePiece(projet, sessions.length);
    this.grille = grilleDe(this.carte, {});
    const meubles = dessinerPiece(this, projet, categorieDe(projet).accent);
    sessions.forEach((s, i) => {
      const poste = this.carte?.postes[i];
      if (poste && this.carte) this.agents.set(s.id, new Agent(this, poste, this.carte, this.r.persos));
    });
    this.chris = new Marcheur(this, 'chris', this.r.persos, this.carte.depart, 110);
    this.installerControles();
    this.rendreInteractifs(meubles, sessions);
    this.cameraPiece();
    this.boutonRetour();
  }

  /** « ← Station » : un vrai bouton de l'interface (hors du dessin, que le zoom de la caméra déformerait). */
  private boutonRetour(): void {
    const b = document.createElement('button');
    b.className = 'bouton-pixel retour-station';
    b.textContent = '← Station';
    b.addEventListener('click', () => this.aller('station'));
    document.getElementById('ui')?.append(b);
    this.events.once('shutdown', () => b.remove());
    this.input.keyboard?.on('keydown-ESC', () => this.aller('station'));
  }

  private cameraPiece(): void {
    const cam = this.cameras.main;
    const w = FOND.w * ECHELLE_FOND;
    const h = FOND.h * ECHELLE_FOND;
    cam.setBounds(0, 0, w, h);
    const zoom = Math.min(1 / ECHELLE_FOND, Math.max(this.scale.width / w, this.scale.height / h));
    cam.setZoom(zoom).centerOn(w / 2, h / 2);
    if (this.chris && zoom * w > this.scale.width + 4) cam.startFollow(this.chris.sprite, true, 0.12, 0.12);
    cam.setRoundPixels(true);
  }

  private installerControles(): void {
    const kb = this.input.keyboard;
    if (kb) {
      // addKeys renvoie un objet indexé par les noms demandés ; sans capture : les touches restent aux champs de saisie
      this.touches = kb.addKeys('Z,Q,S,D,W,A,UP,DOWN,LEFT,RIGHT', false) as Record<string, Phaser.Input.Keyboard.Key>;
      const fin = ecouterPanneau((p) => {
        kb.enabled = p === null;
        if (p) kb.resetKeys();
      });
      this.events.once('shutdown', fin);
    }
    this.input.on('pointerup', (p: Phaser.Input.Pointer, cibles: unknown[]) => {
      if (cibles.length || p.getDistance() > 6 || !this.grille) return;
      this.chris?.allerA(this.grille, { x: p.worldX, y: p.worldY });
    });
    for (const [id, a] of this.agents) a.corps.sprite.on('pointerup', () => ouvrir({ type: 'agent', sessionId: id }));
  }

  /** Les meubles utiles s'ouvrent au clic : baie → terminal du projet, bibliothèque → ses fichiers, table → réunion. */
  private rendreInteractifs(meubles: Phaser.GameObjects.Zone[], sessions: ResumeSession[]): void {
    const s = sessions[0];
    const e = this.magasin.lire();
    const machine = s?.machine ?? e.machines[0]?.id ?? '';
    const cwd = s?.cwd ?? e.machines[0]?.racines[0] ?? '/';
    const panneaux: Record<string, () => Panneau> = {
      baie: () => ({ type: 'terminal', machine, cwd, titre: s?.projet.nom ?? 'Terminal' }),
      biblio: () => ({ type: 'fichiers', machine, chemin: cwd }),
      'table-cafe': () => ({ type: 'reunion' }),
    };
    for (const m of meubles) {
      const panneau = panneaux[m.name];
      if (!panneau) continue;
      m.setInteractive({ useHandCursor: true }).on('pointerup', () => ouvrir(panneau()));
    }
  }

  /** Le monde suit les sessions : une session de plus ou de moins, ou un changement d'état dans la station, redessine
   * la vue ; dans une pièce, un changement d'état fait bouger le Clawd concerné. */
  private suivreSessions(vue: string): void {
    const signature = (l: ResumeSession[]): string => `${cleSessions(l)}|${l.map((s) => etatDansLeMonde(s, Date.now())).join()}`;
    const depart = signature(sessionsDuMonde(this.magasin.lire()));
    const appliquer = (sessions: ResumeSession[]): void => {
      if (vue === 'station') {
        if (signature(sessions) !== depart) this.scene.restart();
        return;
      }
      const ici = sessions.filter((s) => s.projet.nom === vue);
      if (ici.some((s) => !this.agents.has(s.id)) || ici.length !== this.agents.size) {
        this.scene.restart();
        return;
      }
      for (const s of ici) if (this.grille) this.agents.get(s.id)?.changerEtat(etatDansLeMonde(s, Date.now()), this.grille);
    };
    appliquer(sessionsDuMonde(this.magasin.lire()));
    const fin = this.magasin.abonner((e) => sessionsDuMonde(e), appliquer, (a, b) => a.length === b.length && a.every((s, i) => s === b[i]));
    const minuteur = this.time.addEvent({ delay: 20_000, loop: true, callback: () => appliquer(sessionsDuMonde(this.magasin.lire())) });
    this.events.once('shutdown', () => {
      fin();
      minuteur.remove();
      this.agents.clear();
      this.chris = null;
      this.carte = null;
      this.grille = null;
    });
  }

  update(_t: number, dt: number): void {
    if (!this.chris || !this.grille) return;
    const k = this.touches;
    if (k) {
      const vx = (k.D?.isDown || k.RIGHT?.isDown ? 1 : 0) - (k.Q?.isDown || k.A?.isDown || k.LEFT?.isDown ? 1 : 0);
      const vy = (k.S?.isDown || k.DOWN?.isDown ? 1 : 0) - (k.Z?.isDown || k.W?.isDown || k.UP?.isDown ? 1 : 0);
      if (vx || vy || (!this.chris.enMarche && this.chris.pose.includes('marche'))) this.chris.pousser(this.grille, vx, vy, dt);
    }
    this.chris.miseAJour(dt);
    for (const a of this.agents.values()) a.miseAJour(dt, this.time.now);
  }
}
