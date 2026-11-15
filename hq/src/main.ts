// Responsabilité : démarrer Agent HQ — le modèle de données (démo ou relais selon la configuration) puis le monde
// (Phaser) dans la page, une fois la police pixel chargée et la fenêtre visible.
import Phaser from 'phaser';
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';

import { CLE_JETON, creerSourceMonde, demarrerMonde, lireConfig, MagasinMonde, stockageNavigateur } from './donnees';
import { Connexion } from './ui/connexion/Connexion';
import { SceneMonde } from './monde/scene-monde';
import { ouvrir } from './ui/bus';
import { FournisseurMonde } from './ui/contexte';
import { Racine } from './ui/Racine';
import './ui/theme.css';

/** Mode relais sans jeton : écran de connexion au lieu de la démo. Base par défaut = l'origine de la page (l'app est
 * servie par le relais sous /hq/). */
function demanderConnexion(): boolean {
  if (import.meta.env['VITE_SOURCE'] !== 'relais') return false;
  const base = import.meta.env['VITE_RELAIS_URL'] || location.origin;
  if (localStorage.getItem(CLE_JETON)) return false;
  const ui = document.getElementById('ui');
  if (ui) createRoot(ui).render(createElement(Connexion, { base }));
  return true;
}

async function demarrer(): Promise<void> {
  if (demanderConnexion()) return;
  const magasin = new MagasinMonde();
  const env = {
    VITE_SOURCE: import.meta.env['VITE_SOURCE'],
    VITE_RELAIS_URL: import.meta.env['VITE_RELAIS_URL'] || location.origin,
  };
  const source = creerSourceMonde(lireConfig(env, stockageNavigateur()));
  demarrerMonde(source, magasin).catch((err) => console.error('données du monde indisponibles', err));
  const ui = document.getElementById('ui');
  if (ui) createRoot(ui).render(createElement(FournisseurMonde, { magasin, source }, createElement(Racine)));
  Object.assign(window, { __hq: { ouvrir, magasin } }); // crochet des essais de bout en bout
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
