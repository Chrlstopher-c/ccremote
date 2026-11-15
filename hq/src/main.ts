// Responsabilité : démarrer Agent HQ — le modèle de données (démo ou relais selon la configuration) puis le monde
// (Phaser) dans la page, une fois la police pixel chargée et la fenêtre visible.
import Phaser from 'phaser';

import { creerSourceMonde, demarrerMonde, lireConfig, MagasinMonde, stockageNavigateur } from './donnees';
import { SceneMonde } from './monde/scene-monde';

async function demarrer(): Promise<void> {
  const magasin = new MagasinMonde();
  const env = { VITE_SOURCE: import.meta.env['VITE_SOURCE'], VITE_RELAIS_URL: import.meta.env['VITE_RELAIS_URL'] };
  const source = creerSourceMonde(lireConfig(env, stockageNavigateur()));
  demarrerMonde(source, magasin).catch((err) => console.error('données du monde indisponibles', err));
  try {
    await document.fonts.load('22px "Pixelify Sans"');
  } catch (err) {
    console.warn('police pixel indisponible, repli monospace', err);
  }
  // Onglet caché au chargement (taille nulle) : WebGL refuse un tampon vide, on attend d'avoir une taille.
  while (!window.innerWidth || !window.innerHeight) {
    await new Promise((fin) => window.addEventListener('resize', fin, { once: true }));
  }
  const jeu = new Phaser.Game({
    type: Phaser.AUTO,
    parent: 'jeu',
    backgroundColor: '#14101f',
    pixelArt: true,
    scale: { mode: Phaser.Scale.RESIZE, width: window.innerWidth, height: window.innerHeight },
    scene: [SceneMonde],
  });
  jeu.registry.set('magasin', magasin);
}

void demarrer();
