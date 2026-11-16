// Responsabilité : la VUE PIÈCE (pure, testable) — l'intérieur d'un compartiment de projet, posé sur l'image de la
// pièce MEUBLÉE rendue par le modèle local à partir de l'image StockIOP de Chris (public/station/piece.png) : meubles,
// lumière et ombres sont dans l'image. Ici, seulement ce qui se joue dessus, en coordonnées relatives (0..1) : où l'on
// marche, où s'assoit chaque agent, quels meubles s'ouvrent. L'image est réduite à l'échelle des personnages
// (ECHELLE_FOND) ; la caméra zoome pour la rendre à sa résolution d'origine.
import type { Carte, Case, Poste } from '../carte/plan';

export const CASE = 40;
export const FOND = { w: 1664, h: 928 }; // taille de l'image de la pièce
export const ECHELLE_FOND = 0.54; // Chris mesure 130 px dans l'image, 70 px dans le monde

export interface Zone {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

// Zones relatives, mesurées sur l'image de la pièce meublée.
const SOL: readonly Zone[] = [
  { x0: 0.21, y0: 0.405, x1: 0.69, y1: 0.465 }, // devant les bureaux
  { x0: 0.29, y0: 0.465, x1: 0.34, y1: 0.62 }, // la porte en bois
  { x0: 0.17, y0: 0.62, x1: 0.97, y1: 0.75 }, // la coursive
  { x0: 0.73, y0: 0.53, x1: 0.97, y1: 0.62 }, // le coin café
];
// Les deux chaises des bureaux, puis des places debout (au-delà, les agents travaillent debout dans la pièce).
const PLACES: readonly { x: number; y: number; assis: boolean }[] = [
  { x: 0.368, y: 0.398, assis: true }, { x: 0.452, y: 0.398, assis: true },
  { x: 0.53, y: 0.45, assis: false }, { x: 0.25, y: 0.45, assis: false }, { x: 0.62, y: 0.455, assis: false },
];

/** Meubles qui s'ouvrent au clic, et le panneau qu'ils ouvrent. */
export const MEUBLES: readonly (Zone & { nom: 'biblio' | 'baie' | 'table-cafe' })[] = [
  { nom: 'biblio', x0: 0.216, y0: 0.235, x1: 0.272, y1: 0.39 },
  { nom: 'baie', x0: 0.279, y0: 0.21, x1: 0.332, y1: 0.39 },
  { nom: 'table-cafe', x0: 0.755, y0: 0.52, x1: 0.845, y1: 0.63 },
];

/** Les dossiers des chaises : redessinés devant l'agent assis, comme dans l'image de référence. */
export const DOSSIERS: readonly Zone[] = [
  { x0: 0.346, y0: 0.328, x1: 0.387, y1: 0.4 }, { x0: 0.43, y0: 0.328, x1: 0.473, y1: 0.4 },
];

/** L'enseigne peinte au mur (« StockIOP » dans l'image) : recouverte par le nom du projet. */
export const ENSEIGNE: Zone = { x0: 0.27, y0: 0.148, x1: 0.405, y1: 0.21 };

export const relatif = (x: number, y: number): { x: number; y: number } => ({
  x: x * FOND.w * ECHELLE_FOND,
  y: y * FOND.h * ECHELLE_FOND,
});

function cases(): Case[][] {
  const w = Math.ceil((FOND.w * ECHELLE_FOND) / CASE);
  const h = Math.ceil((FOND.h * ECHELLE_FOND) / CASE);
  const grille = Array.from({ length: h }, () => Array.from({ length: w }, (): Case => ({ nature: 'mur', sol: 'dalles' })));
  for (const z of SOL) {
    const a = relatif(z.x0, z.y0);
    const b = relatif(z.x1, z.y1);
    for (let y = Math.floor(a.y / CASE); y < Math.ceil(b.y / CASE); y++) {
      for (let x = Math.floor(a.x / CASE); x < Math.ceil(b.x / CASE); x++) {
        const ligne = grille[y];
        if (ligne?.[x]) ligne[x] = { nature: 'sol', sol: 'dalles' };
      }
    }
  }
  return grille;
}

export const assisA = (k: number): boolean => PLACES[k]?.assis ?? false;

/** La carte d'une pièce de projet où travaillent `agents` sessions vivantes, chacune à sa place. */
export function construirePiece(projet: string, agents: number): Carte {
  const postes: Poste[] = Array.from({ length: agents }, (_, k) => {
    const p = PLACES[k] ?? { x: 0.3 + 0.05 * (k - PLACES.length), y: 0.7 };
    const siege = relatif(p.x, p.y);
    return { projet, siege, debout: { x: siege.x + 30, y: relatif(0, 0.45).y } };
  });
  const coursive = relatif(0.31, 0.69);
  const cafe = relatif(0.88, 0.58);
  const grille = cases();
  return {
    largeur: grille[0]?.length ?? 0, hauteur: grille.length, cases: grille, objets: [], postes,
    plaques: [], portes: [], fenetres: [],
    lieux: { cafe, fumoir: cafe, reunion: cafe, bibliotheque: relatif(0.24, 0.45), terminal: relatif(0.3, 0.45),
      entree: coursive },
    depart: coursive,
  };
}
