// Responsabilité : construire la carte du monde à partir des sessions (leur projet). Plan façon The Escapists 2 : un
// couloir central ; au nord, une pièce par projet où ses agents travaillent ensemble ; au sud, les pièces communes
// (bibliothèque, réunion, hall d'entrée avec café, salle serveurs) ; dehors, pelouse et allée. Les murs sont des cases
// (le rendu dessine leur dessus et leur face, voir peinture/murs.ts). Pur : aucune notion de Phaser, testable.
import { meublerCommunes, meublerProjet, type Communes, type Hauteurs } from './meubler';

export const TUILE = 32;

export type Nature = 'dehors' | 'sol' | 'mur';
export type Sol =
  | 'herbe' | 'allee' | 'paves' | 'dalles' | 'seuil' | 'parquet-a' | 'parquet-b' | 'carrelage'
  | 'moquette-verte' | 'moquette-bleue' | 'beton';

export interface Case {
  nature: Nature;
  sol: Sol; // pour un mur : le sol de sa pièce (le rendu peint autour de lui le sol des cases voisines)
}

export interface Objet {
  nom: string; // nom dans public/objets.json
  x: number; // centre, en pixels du monde
  y: number; // bas (pieds de l'objet), en pixels du monde
  bloque: boolean;
  miroir?: boolean;
  auSol?: boolean; // posé à plat (tapis) : toujours dessous des personnages
  auMur?: boolean; // accroché à la face d'un mur (tableau) : derrière tout ce qui est au sol
}

export type Lieu = 'cafe' | 'reunion' | 'bibliotheque' | 'terminal' | 'fumoir' | 'entree';

export interface Poste {
  projet: string;
  siege: { x: number; y: number }; // pied de sa chaise : il s'y assoit pour travailler (vu de dos)
  debout: { x: number; y: number }; // où il se tient quand il attend Chris
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Plaque {
  texte: string;
  x: number;
  y: number;
}

export interface Carte {
  largeur: number; // en cases
  hauteur: number;
  cases: Case[][]; // [y][x]
  objets: Objet[];
  postes: Poste[]; // un par session, dans l'ordre reçu
  plaques: Plaque[];
  portes: Rect[]; // ouvertures (cases de sol dans une ligne de mur)
  fenetres: { x: number; y: number }[]; // cases de mur percées d'une fenêtre (sur leur face)
  lieux: Record<Lieu, { x: number; y: number }>;
  depart: { x: number; y: number }; // où apparaît Chris
}

const MARGE = 5; // pelouse autour du bâtiment
const NORD = 3; // rang du mur extérieur nord
const HAUT_BUREAU = 6; // rangs d'une pièce de projet (5 utiles + le mur du couloir)
const HAUT_COULOIR = 4; // 3 rangs utiles + le mur des pièces communes
const HAUT_COMMUNE = 7; // 6 rangs utiles + le mur extérieur sud
const DEHORS_SUD = 8;
const PAR_AGENT = 3; // cases de large par bureau
const COMMUNES_MIN = [7, 9, 8, 6] as const; // bibliothèque, réunion, hall, serveurs

export const centreCase = (c: number): number => c * TUILE + TUILE / 2;

export function poser(c: Case[][], r: Rect, nature: Nature, sol: Sol): void {
  for (let y = r.y; y < r.y + r.h; y++) {
    for (let x = r.x; x < r.x + r.w; x++) {
      const ligne = c[y];
      if (ligne?.[x]) ligne[x] = { nature, sol };
    }
  }
}

/** Une pièce : murs sur le pourtour (partagés avec les voisines), sol à l'intérieur. */
function piece(c: Case[][], r: Rect, sol: Sol): void {
  poser(c, r, 'mur', sol);
  poser(c, { x: r.x + 1, y: r.y + 1, w: r.w - 2, h: r.h - 2 }, 'sol', sol);
}

/** Largeurs utiles réparties pour remplir `total` cases (murs compris), le surplus distribué tour à tour. */
export function repartir(minimums: readonly number[], total: number): number[] {
  const l = [...minimums];
  let reste = total - (1 + l.reduce((s, w) => s + w + 1, 0));
  for (let i = 0; reste > 0 && l.length; i = (i + 1) % l.length, reste--) l[i] = (l[i] ?? 0) + 1;
  return l;
}

/** Projets dans l'ordre de première apparition, avec le rang de chaque session dans sa pièce. */
function regrouper(projets: readonly string[]): { noms: string[]; rang: number[] } {
  const noms: string[] = [];
  const compte = new Map<string, number>();
  const rang = projets.map((p) => {
    if (!compte.has(p)) noms.push(p);
    const k = compte.get(p) ?? 0;
    compte.set(p, k + 1);
    return k;
  });
  return { noms, rang };
}

interface Gabarit {
  w: number;
  h: number;
  bx: number;
  batW: number;
  couloirN: number; // mur entre les bureaux et le couloir
  sudN: number; // mur entre le couloir et les pièces communes
  basY: number; // mur extérieur sud
}

function gabarit(batW: number): Gabarit {
  const couloirN = NORD + HAUT_BUREAU;
  const sudN = couloirN + HAUT_COULOIR;
  const basY = sudN + HAUT_COMMUNE;
  return { w: batW + 2 * MARGE, h: basY + 1 + DEHORS_SUD, bx: MARGE, batW, couloirN, sudN, basY };
}

function largeurs(agents: readonly number[]): { projets: number[]; communes: number[]; batW: number } {
  const minProjets = agents.length ? agents.map((n) => Math.max(6, PAR_AGENT * n + 3)) : [6];
  const somme = (l: readonly number[]): number => 1 + l.reduce((s, w) => s + w + 1, 0);
  const batW = Math.max(somme(minProjets), somme(COMMUNES_MIN), 34);
  return { projets: repartir(minProjets, batW), communes: repartir(COMMUNES_MIN, batW), batW };
}

interface Base {
  g: Gabarit;
  cases: Case[][];
  objets: Objet[];
  plaques: Plaque[];
  portes: Rect[];
  fenetres: Carte['fenetres'];
}

function percer(base: Base, x: number, y: number, w: number): void {
  poser(base.cases, { x, y, w, h: 1 }, 'sol', 'seuil');
  base.portes.push({ x, y, w, h: 1 });
}

function bureaux(base: Base, projets: readonly number[], noms: readonly string[]): Rect[] {
  const { g, cases } = base;
  let x = g.bx;
  return projets.map((w, i) => {
    const r = { x, y: NORD, w: w + 2, h: HAUT_BUREAU + 1 };
    piece(cases, r, i % 2 ? 'parquet-b' : 'parquet-a');
    percer(base, x + 1, g.couloirN, 2);
    base.plaques.push({ texte: noms[i] ?? 'libre', x: (x + 3 + (w - 2) / 2) * TUILE, y: g.couloirN * TUILE + 21 });
    for (let f = x + 3; f + 1 < x + w; f += 5) base.fenetres.push({ x: f, y: NORD }, { x: f + 1, y: NORD });
    x += w + 1;
    return r;
  });
}

function communes(base: Base, l: readonly number[]): Communes {
  const y = base.g.sudN;
  const h = HAUT_COMMUNE + 1;
  const [lb = 7, lr = 9, lh = 8, ls = 6] = l;
  const biblio = { x: base.g.bx, y, w: lb + 2, h };
  const reunion = { x: biblio.x + lb + 1, y, w: lr + 2, h };
  const hall = { x: reunion.x + lr + 1, y, w: lh + 2, h };
  const serveurs = { x: hall.x + lh + 1, y, w: ls + 2, h };
  piece(base.cases, biblio, 'moquette-verte');
  piece(base.cases, reunion, 'moquette-bleue');
  piece(base.cases, hall, 'carrelage');
  piece(base.cases, serveurs, 'beton');
  for (const r of [biblio, reunion, serveurs]) percer(base, r.x + r.w - 4, y, 2);
  percer(base, hall.x + Math.floor(hall.w / 2) - 1, y, 3);
  return { biblio, reunion, hall, serveurs };
}

function dehors(base: Base, entreeX: number): { x: number; y: number } {
  const { g, cases, objets } = base;
  poser(cases, { x: g.bx - 1, y: g.basY + 1, w: g.batW + 2, h: 2 }, 'dehors', 'paves');
  poser(cases, { x: entreeX - 1, y: g.basY + 3, w: 4, h: DEHORS_SUD - 2 }, 'dehors', 'allee');
  for (let x = g.bx + 2; x < g.bx + g.batW - 2; x += 4) {
    if (Math.abs(x - entreeX) > 2) base.fenetres.push({ x, y: g.basY });
  }
  for (const dx of [-2, 4]) {
    objets.push({ nom: 'lampadaire', x: centreCase(entreeX + dx), y: (g.basY + 5) * TUILE, bloque: true });
  }
  const arbres: [number, number][] = [[1, 4], [2, 10], [1, 16], [g.w - 2, 4], [g.w - 3, 11], [g.w - 2, 17]];
  for (let x = g.bx + 4; x < g.bx + g.batW; x += 9) arbres.push([x, 1]);
  for (const [x, y] of arbres) objets.push({ nom: 'arbre', x: centreCase(x), y: (y + 1) * TUILE, bloque: true });
  const fumoir = { x: (entreeX + 7) * TUILE, y: (g.basY + 6) * TUILE };
  objets.push({ nom: 'banc', x: fumoir.x + 40, y: fumoir.y - 2, bloque: true });
  objets.push({ nom: 'cendrier', x: fumoir.x - 4, y: fumoir.y - 4, bloque: true });
  return fumoir;
}

function postesDesSessions(projets: readonly string[], parProjet: readonly Poste[][]): Poste[] {
  const { noms, rang } = regrouper(projets);
  return projets.map((p, i) => {
    const poste = parProjet[noms.indexOf(p)]?.[rang[i] ?? 0];
    return { projet: p, siege: poste?.siege ?? { x: 0, y: 0 }, debout: poste?.debout ?? { x: 0, y: 0 } };
  });
}

/** Le monde complet : `projets` = le projet de chaque session, dans l'ordre (postes[i] = poste de la session i). */
export function construireCarte(projets: readonly string[], hauteurs: Hauteurs = {}): Carte {
  const { noms } = regrouper(projets);
  const agents = noms.map((n) => projets.filter((p) => p === n).length);
  const l = largeurs(agents);
  const g = gabarit(l.batW);
  const cases = Array.from({ length: g.h }, () => Array.from({ length: g.w }, (): Case => ({ nature: 'dehors', sol: 'herbe' })));
  const base: Base = { g, cases, objets: [], plaques: [], portes: [], fenetres: [] };
  piece(cases, { x: g.bx, y: NORD, w: g.batW, h: g.basY - NORD + 1 }, 'dalles');
  const pieces = bureaux(base, l.projets, noms);
  const parProjet = pieces.map((r, i) => meublerProjet(r, agents[i] ?? 0, base.objets, hauteurs));
  const c = communes(base, l.communes);
  const lieux = meublerCommunes(c, base.objets, hauteurs);
  const entreeX = c.hall.x + Math.floor(c.hall.w / 2) - 1;
  percer(base, entreeX, g.basY, 2);
  const fumoir = dehors(base, entreeX);
  const entree = { x: (entreeX + 1) * TUILE, y: (g.basY + 4) * TUILE };
  return {
    largeur: g.w, hauteur: g.h, cases, objets: base.objets, postes: postesDesSessions(projets, parProjet),
    plaques: base.plaques, portes: base.portes, fenetres: base.fenetres, lieux: { ...lieux, fumoir, entree },
    depart: entree,
  };
}
