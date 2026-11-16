// Responsabilité : le plan de la station (pur, testable) — un PONT par catégorie de projets, empilés dans l'espace et
// reliés par des tubes-sas au bout des coursives. Un pont = une rangée de compartiments (un par projet, largeur selon
// ses agents) au-dessus d'une coursive, puis la tranche de la coque. Cotes calées sur le kit prélevé dans l'image de
// référence (art/kit_bandes.py) : une case = une plaque de sol = 40 px du monde.
import type { Carte, Case, Objet, Poste } from '../carte/plan';
import { categorieDe, type Categorie } from './categories';

export const CASE = 40;

// Cotes verticales d'un pont, en px du monde depuis le haut du mur du fond (bandes du kit ×2).
export const COTE = {
  murFond: 134, // coiffe + crème + plinthe
  murBasHaut: 266, // haut du mur côté coursive (68 px)
  coursive: 334, // pied du mur bas = début de la coursive
  bord: 406, // bande lumineuse, lèvre et tranche de la coque (84 px)
  pont: 600, // hauteur d'un pont, vide spatial compris (15 cases)
} as const;

const RANGS = { murFond: 4, solPiece: [4, 5, 6] as const, murBas: 7, coursive: [8, 9] as const } as const;
const MARGE = 3; // cases d'espace à gauche
const PAR_AGENT = 3;

export interface Compartiment {
  projet: string;
  x: number; // première case utile
  w: number; // cases utiles
  porte: number; // case de la porte (2 cases)
  ilot?: 'cafe' | 'machines'; // salle commune (pas un projet) : café, salle des machines
}

export interface Pont {
  categorie: Categorie;
  y: number; // case du haut du mur du fond
  x: number; // case du premier mur
  w: number; // cases, murs compris
  compartiments: Compartiment[];
  tube: number; // première case de la salle de sas (2 cases), au bout droit du pont, commune à tous les ponts
}

export interface Station {
  carte: Carte;
  ponts: Pont[];
}

interface Groupe {
  categorie: Categorie;
  projets: { nom: string; agents: number }[];
}

/** Projets regroupés par catégorie, dans l'ordre des catégories, chaque projet avec son nombre d'agents. */
export function grouper(projets: readonly string[]): Groupe[] {
  const groupes = new Map<string, Groupe>();
  for (const p of projets) {
    const c = categorieDe(p);
    const g = groupes.get(c.id) ?? { categorie: c, projets: [] };
    const deja = g.projets.find((q) => q.nom === p);
    if (deja) deja.agents += 1;
    else g.projets.push({ nom: p, agents: 1 });
    groupes.set(c.id, g);
  }
  return [...groupes.values()];
}

function largeurPiece(agents: number): number {
  return Math.max(5, PAR_AGENT * agents + 2);
}

function poser(cases: Case[][], x: number, y: number, w: number, h: number, nature: Case['nature']): void {
  for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) if (cases[j]?.[i]) cases[j]![i] = { nature, sol: 'dalles' };
}

const ILOT_MIN = 5;
const NOM_ILOT = { cafe: 'Café', machines: 'Machines' } as const;

function tracerPont(g: Groupe, y: number, avecCafe: boolean): Pont {
  let x = MARGE + 1;
  const compartiments: Compartiment[] = g.projets.map((p) => {
    const w = largeurPiece(p.agents);
    const c = { projet: p.nom, x, w, porte: x + 1 };
    x += w + 1;
    return c;
  });
  if (avecCafe) {
    compartiments.push({ projet: NOM_ILOT.cafe, x, w: 7, porte: x + 1, ilot: 'cafe' });
    x += 8;
  }
  return { categorie: g.categorie, y, x: MARGE, w: x - MARGE, compartiments, tube: x };
}

/** L'espace libre au bout d'un pont (jusqu'au sas) devient une salle des machines plutôt qu'un vide. */
function combler(p: Pont): void {
  const der = p.compartiments.at(-1);
  const debut = der ? der.x + der.w + 1 : p.x + 1;
  const w = p.tube - debut - 1;
  if (w >= ILOT_MIN) p.compartiments.push({ projet: NOM_ILOT.machines, x: debut, w, porte: debut + 1, ilot: 'machines' });
}

/** Tous les ponts finissent sur la même colonne de sas : le tube descend droit d'un pont à l'autre. */
function aligner(ponts: Pont[]): void {
  const tube = Math.max(...ponts.map((p) => p.tube));
  for (const p of ponts) {
    p.tube = tube;
    p.w = tube + 2 - p.x;
  }
}

function graver(cases: Case[][], p: Pont): void {
  poser(cases, p.x, p.y, p.w + 2, RANGS.murFond, 'mur');
  poser(cases, p.x, p.y + RANGS.murBas, p.w + 2, 1, 'mur');
  for (const c of p.compartiments) {
    poser(cases, c.x, p.y + RANGS.solPiece[0], c.w, RANGS.solPiece.length, 'sol');
    poser(cases, c.porte, p.y + RANGS.murBas, 2, 1, 'sol');
  }
  poser(cases, p.tube, p.y + RANGS.solPiece[0], 2, RANGS.solPiece.length + 1, 'sol'); // salle de sas + son écoutille
  poser(cases, p.x, p.y + RANGS.coursive[0], p.w + 2, RANGS.coursive.length, 'sol');
}

/** Le tube : de la coursive du pont `a` jusqu'à la salle de sas du pont `b`, à travers le vide et son mur du fond. */
function relier(cases: Case[][], a: Pont, b: Pont): void {
  poser(cases, a.tube, a.y + RANGS.coursive[0], 2, b.y + RANGS.solPiece[0] - (a.y + RANGS.coursive[0]), 'sol');
}

function meublerIlot(y0: number, c: Compartiment, objets: Objet[]): void {
  const milieu = (c.x + c.w / 2) * CASE;
  if (c.ilot === 'cafe') {
    objets.push({ nom: 'comptoir', x: milieu - CASE, y: y0 + 60, bloque: true });
    objets.push({ nom: 'table-cafe', x: milieu + CASE, y: y0 + 130, bloque: true });
    objets.push({ nom: 'plante3', x: (c.x + c.w - 0.5) * CASE, y: y0 + 34, bloque: true });
    return;
  }
  const n = Math.min(4, Math.floor(c.w / 2));
  for (let k = 0; k < n; k++) objets.push({ nom: 'baie', x: (c.x + 1 + k * 1.4) * CASE, y: y0 + 70, bloque: true });
  objets.push({ nom: 'cryo-couche', x: (c.x + c.w - 1.5) * CASE, y: y0 + 150, bloque: true });
}

/** Meubles d'un compartiment et poste de chaque agent (bureau contre le mur du fond). */
function meubler(p: Pont, c: Compartiment, agents: number, objets: Objet[]): Poste[] {
  const y0 = p.y * CASE + COTE.murFond;
  if (c.ilot) {
    meublerIlot(y0, c, objets);
    return [];
  }
  objets.push({ nom: 'plante', x: (c.x + 0.5) * CASE, y: y0 + 34, bloque: true });
  objets.push({ nom: 'poubelle', x: (c.x + c.w - 0.5) * CASE, y: y0 + 34, bloque: true });
  return Array.from({ length: agents }, (_, k) => {
    const x = (c.x + 1 + PAR_AGENT * k + 1.5) * CASE;
    objets.push({ nom: 'poste', x, y: y0 + 64, bloque: true });
    return { projet: c.projet, siege: { x, y: y0 + 70 }, debout: { x: x + 46, y: y0 + 96 } };
  });
}

export function construireStation(projets: readonly string[]): Station {
  const groupes = grouper(projets.length ? projets : ['agent-hq']);
  const ponts = groupes.map((g, i) => tracerPont(g, 1 + i * (COTE.pont / CASE), i === 0));
  aligner(ponts);
  ponts.forEach(combler);
  const largeur = Math.max(...ponts.map((p) => p.tube + 4), 24);
  const hauteur = 1 + ponts.length * (COTE.pont / CASE);
  const cases = Array.from({ length: hauteur }, () => Array.from({ length: largeur }, (): Case => ({ nature: 'dehors', sol: 'herbe' })));
  ponts.forEach((p) => graver(cases, p));
  ponts.slice(1).forEach((p, i) => relier(cases, ponts[i] as Pont, p));
  for (const row of cases) for (const c of row) if (c.nature === 'dehors') c.nature = 'mur'; // le vide : on n'y marche pas
  const objets: Objet[] = [];
  const parProjet = new Map<string, Poste[]>();
  ponts.forEach((p, i) => p.compartiments.forEach((c) => {
    const agents = c.ilot ? 0 : groupes[i]?.projets.find((q) => q.nom === c.projet)?.agents ?? 0;
    const postes = meubler(p, c, agents, objets);
    if (!c.ilot) parProjet.set(c.projet, postes);
  }));
  return { carte: carteDe(projets, cases, objets, parProjet, ponts), ponts };
}

function carteDe(projets: readonly string[], cases: Case[][], objets: Objet[], parProjet: Map<string, Poste[]>,
  ponts: Pont[]): Carte {
  const vu = new Map<string, number>();
  const postes = projets.map((p) => {
    const k = vu.get(p) ?? 0;
    vu.set(p, k + 1);
    return parProjet.get(p)?.[k] ?? { projet: p, siege: { x: 0, y: 0 }, debout: { x: 0, y: 0 } };
  });
  const p0 = ponts[0] as Pont; // il y a toujours au moins un pont (construireStation garantit un projet)
  const couloir = { x: (p0.x + 2) * CASE, y: (p0.y + 9) * CASE };
  const lieu = (dx: number): { x: number; y: number } => ({ x: couloir.x + dx * CASE, y: couloir.y });
  const ilot = (nom: 'cafe' | 'machines'): { x: number; y: number } | null => {
    for (const p of ponts) {
      const c = p.compartiments.find((k) => k.ilot === nom);
      if (c) return { x: (c.x + c.w / 2) * CASE, y: p.y * CASE + COTE.murFond + 170 };
    }
    return null;
  };
  return {
    largeur: cases[0]?.length ?? 0, hauteur: cases.length, cases, objets, postes, plaques: [], portes: [], fenetres: [],
    lieux: { cafe: ilot('cafe') ?? lieu(4), reunion: lieu(6), bibliotheque: lieu(2), terminal: ilot('machines') ?? lieu(8),
      fumoir: ilot('cafe') ?? lieu(10), entree: lieu(0) },
    depart: couloir,
  };
}
