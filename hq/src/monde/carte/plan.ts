// Responsabilité : construire la carte du monde à partir des projets. Le bâtiment d'Agent HQ est vu murs baissés,
// façon Les Sims : seul le mur du fond montre sa face (avec fenêtres), les cloisons intérieures sont des murs fins
// percés de portes, la façade en briques se voit depuis la rue. Organisation : une rangée de bureaux (un par projet)
// au nord, un couloir, puis bibliothèque, salle de réunion, hall d'entrée avec coin café, salle serveurs.
// Dehors : parvis, fumoir, rue. Pur : aucune notion de Phaser, testable.

export const TUILE = 32;

export type Nature = 'dehors' | 'sol' | 'mur' | 'face';

export interface Case {
  nature: Nature;
  tuile: string; // nom dans public/tuiles.json (pour un mur : choisi au rendu selon ses voisins)
}

export interface Objet {
  nom: string; // nom dans public/objets.json
  x: number; // centre, en pixels du monde
  y: number; // bas (pieds de l'objet), en pixels du monde
  bloque: boolean;
  miroir?: boolean;
}

export type Lieu = 'cafe' | 'reunion' | 'bibliotheque' | 'terminal' | 'fumoir' | 'entree';

export interface Poste {
  projet: string;
  siege: { x: number; y: number }; // pied de sa chaise : il s'y assoit pour travailler (vu de dos)
  debout: { x: number; y: number }; // où il se tient quand il attend Chris
  plaque: { x: number; y: number };
}

export interface Carte {
  largeur: number; // en cases
  hauteur: number;
  cases: Case[][]; // [y][x]
  objets: Objet[];
  postes: Poste[];
  lieux: Record<Lieu, { x: number; y: number }>;
  depart: { x: number; y: number }; // où apparaît Chris
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const PAS_BUREAU = 7; // un bureau = 6 cases utiles + la cloison partagée
const MIN_BUREAUX = 5;

const centre = (c: number): number => c * TUILE + TUILE / 2;

function grilleVide(w: number, h: number): Case[][] {
  return Array.from({ length: h }, (_, y) =>
    Array.from({ length: w }, (_, x) => ({ nature: 'dehors' as const, tuile: `herbe-${(x * 7 + y * 13) % 3}` })),
  );
}

function poser(c: Case[][], r: Rect, nature: Nature, tuile: string): void {
  for (let y = r.y; y < r.y + r.h; y++) {
    for (let x = r.x; x < r.x + r.w; x++) {
      const ligne = c[y];
      if (ligne?.[x]) ligne[x] = { nature, tuile };
    }
  }
}

/** Une pièce : murs sur le pourtour (partagés avec les voisines), sol à l'intérieur. */
function piece(c: Case[][], r: Rect, sol: string): void {
  poser(c, r, 'mur', 'mur');
  poser(c, { x: r.x + 1, y: r.y + 1, w: r.w - 2, h: r.h - 2 }, 'sol', sol);
}

/** Ouverture dans un mur horizontal, marquée d'un seuil. */
function porte(c: Case[][], x: number, y: number, largeur = 2): void {
  poser(c, { x, y, w: largeur, h: 1 }, 'sol', 'seuil');
}

interface Gabarit {
  w: number;
  h: number;
  bx: number;
  batW: number;
  nordY: number; // mur extérieur nord
  couloirY: number; // première rangée du couloir
  sudY: number; // première rangée des pièces du sud
  basY: number; // mur extérieur sud
}

function gabarit(n: number): Gabarit {
  const batW = n * PAS_BUREAU + 1;
  const bx = 6;
  const nordY = 3;
  const couloirY = nordY + 8; // bureaux : 2 rangs de face + 5 rangs utiles, cloison sud
  const sudY = couloirY + 4; // couloir de 3 rangs + cloison
  const basY = sudY + 7;
  return { w: batW + 2 * bx, h: basY + 12, bx, batW, nordY, couloirY, sudY, basY };
}

/** Le mur du fond montre sa face sur deux rangs, avec une fenêtre de temps en temps. */
function faceNord(c: Case[][], g: Gabarit): void {
  for (let x = g.bx + 1; x < g.bx + g.batW - 1; x++) {
    if (c[g.nordY + 1]?.[x]?.nature !== 'sol') continue;
    const fenetre = (x - g.bx) % PAS_BUREAU === 2;
    poser(c, { x, y: g.nordY + 1, w: 1, h: 1 }, 'face', fenetre ? 'fenetre-haut' : 'mur-face-haut');
    poser(c, { x, y: g.nordY + 2, w: 1, h: 1 }, 'face', fenetre ? 'fenetre-bas' : 'mur-face');
  }
}

/** Façade sud vue de la rue : deux rangs de briques sous le mur extérieur, fenêtres éclairées, porte d'entrée. */
function facade(c: Case[][], g: Gabarit, entreeX: number): void {
  for (let x = g.bx; x < g.bx + g.batW; x++) {
    if (x >= entreeX && x < entreeX + 2) {
      poser(c, { x, y: g.basY + 1, w: 1, h: 2 }, 'sol', 'seuil');
      continue;
    }
    const fenetre = (x - g.bx) % 4 === 2;
    poser(c, { x, y: g.basY + 1, w: 1, h: 1 }, 'face', fenetre ? 'facade-haut-fenetre' : 'facade-haut');
    poser(c, { x, y: g.basY + 2, w: 1, h: 1 }, 'face', fenetre ? 'facade-bas-fenetre' : 'facade-bas');
  }
}

function meublerBureau(r: Rect, projet: string, objets: Objet[]): Poste {
  const cx = (r.x + r.w / 2) * TUILE;
  const fond = (r.y + 3) * TUILE; // premier rang de sol sous la face du mur du fond
  objets.push({ nom: 'bureau', x: cx, y: fond + 62, bloque: true });
  objets.push({ nom: 'plante', x: (r.x + 1) * TUILE + 16, y: fond + 26, bloque: true });
  objets.push({ nom: 'tableau', x: (r.x + r.w - 1) * TUILE - 10, y: fond + 36, bloque: true });
  return {
    projet,
    siege: { x: cx, y: fond + 98 },
    debout: { x: cx + 44, y: fond + 118 },
    plaque: { x: cx, y: (r.y + 1) * TUILE + 6 },
  };
}

interface PiecesSud {
  biblio: Rect;
  reunion: Rect;
  hall: Rect;
  serveurs: Rect;
}

function piecesSud(c: Case[][], g: Gabarit): PiecesSud {
  const interieur = g.batW - 1;
  const lb = Math.round(interieur * 0.24);
  const lr = Math.round(interieur * 0.3);
  const lh = Math.round(interieur * 0.26);
  const x0 = g.bx;
  const h = g.basY - g.sudY + 2;
  const y = g.sudY - 1;
  const biblio = { x: x0, y, w: lb + 1, h };
  const reunion = { x: x0 + lb, y, w: lr + 1, h };
  const hall = { x: x0 + lb + lr, y, w: lh + 1, h };
  const serveurs = { x: x0 + lb + lr + lh, y, w: g.batW - (lb + lr + lh), h };
  piece(c, biblio, 'moquette-verte');
  piece(c, reunion, 'moquette-bleue');
  piece(c, hall, 'parquet-1');
  piece(c, serveurs, 'carrelage-sombre');
  for (const r of [biblio, reunion, serveurs]) porte(c, r.x + Math.floor(r.w / 2) - 1, y);
  porte(c, hall.x + Math.floor(hall.w / 2) - 1, y, 3);
  return { biblio, reunion, hall, serveurs };
}

/** Meubles des pièces du sud. Les grands meubles s'adossent au mur du bas : posés contre la cloison du haut, ils
 * déborderaient visuellement sur le couloir (les cloisons sont baissées). */
function meublerSud(p: PiecesSud, objets: Objet[], basY: number): void {
  const fond = basY * TUILE - 2; // pied des meubles adossés au mur extérieur sud
  for (let k = 0; k < 3; k++) {
    objets.push({ nom: 'etagere', x: (p.biblio.x + 1.4 + k * 1.6) * TUILE, y: fond, bloque: true });
  }
  objets.push({ nom: 'canape', x: (p.biblio.x + p.biblio.w / 2) * TUILE, y: (p.biblio.y + 3) * TUILE, bloque: true });
  objets.push({ nom: 'table', x: (p.reunion.x + p.reunion.w / 2) * TUILE, y: (p.reunion.y + 5) * TUILE + 8,
    bloque: true });
  objets.push({ nom: 'plante', x: (p.reunion.x + 1.5) * TUILE, y: fond, bloque: true });
  objets.push({ nom: 'plante', x: (p.reunion.x + p.reunion.w - 1.5) * TUILE, y: fond, bloque: true });
  objets.push({ nom: 'cafe', x: (p.hall.x + 1.8) * TUILE, y: fond, bloque: true });
  objets.push({ nom: 'distributeur', x: (p.hall.x + 3.4) * TUILE, y: fond, bloque: true });
  objets.push({ nom: 'canape', x: (p.hall.x + p.hall.w - 2.6) * TUILE, y: (p.hall.y + 3) * TUILE, bloque: true });
  for (let k = 0; k < 3; k++) {
    objets.push({ nom: 'serveur', x: (p.serveurs.x + 1.3 + k * 1.3) * TUILE, y: fond, bloque: true });
  }
  objets.push({ nom: 'crt', x: (p.serveurs.x + p.serveurs.w - 2) * TUILE, y: (p.serveurs.y + 4) * TUILE,
    bloque: true });
}

function dehors(c: Case[][], g: Gabarit, entreeX: number, objets: Objet[]): Carte['lieux']['fumoir'] {
  const rue = g.h - 5;
  poser(c, { x: 0, y: rue - 1, w: g.w, h: 1 }, 'dehors', 'trottoir');
  poser(c, { x: 0, y: rue, w: g.w, h: 3 }, 'dehors', 'paves-0');
  poser(c, { x: 0, y: rue + 3, w: g.w, h: 1 }, 'dehors', 'trottoir');
  poser(c, { x: entreeX - 1, y: g.basY + 3, w: 4, h: rue - 1 - (g.basY + 3) }, 'dehors', 'terre-0');
  for (let x = 3; x < g.w - 2; x += 8) {
    if (Math.abs(x - entreeX) > 3) {
      objets.push({ nom: 'lampadaire', x: centre(x), y: (rue - 1) * TUILE + 20, bloque: true });
    }
  }
  const arbres = [[2, 4], [3, 11], [1, 17], [g.w - 3, 5], [g.w - 2, 12], [g.w - 3, 18], [9, 1], [g.w - 10, 1]];
  for (const [x, y] of arbres) objets.push({ nom: 'arbre', x: centre(x ?? 0), y: (y ?? 0) * TUILE + 30, bloque: true });
  const fumoir = { x: (entreeX + 5) * TUILE, y: (g.basY + 4) * TUILE + 20 };
  objets.push({ nom: 'cendrier', x: fumoir.x + 26, y: fumoir.y - 2, bloque: true });
  objets.push({ nom: 'banc', x: fumoir.x + 80, y: fumoir.y - 4, bloque: true });
  objets.push({ nom: 'buisson', x: (entreeX - 4) * TUILE, y: (g.basY + 4) * TUILE, bloque: true });
  return fumoir;
}

/** Le monde complet pour une liste de projets (un bureau chacun, au moins cinq emplacements). */
export function construireCarte(projets: readonly string[]): Carte {
  const n = Math.max(MIN_BUREAUX, projets.length);
  const g = gabarit(n);
  const c = grilleVide(g.w, g.h);
  const objets: Objet[] = [];
  piece(c, { x: g.bx, y: g.nordY, w: g.batW, h: g.basY - g.nordY + 1 }, 'parquet-1');
  const postes: Poste[] = [];
  for (let i = 0; i < n; i++) {
    const r = { x: g.bx + i * PAS_BUREAU, y: g.nordY, w: PAS_BUREAU + 1, h: g.couloirY - g.nordY };
    const projet = projets[i];
    piece(c, r, projet ? (i % 2 ? 'parquet-2' : 'parquet-0') : 'parquet-sombre');
    porte(c, r.x + 3, r.y + r.h - 1);
    if (projet) postes.push(meublerBureau(r, projet, objets));
  }
  const sud = piecesSud(c, g);
  meublerSud(sud, objets, g.basY);
  const entreeX = sud.hall.x + Math.floor(sud.hall.w / 2) - 1;
  poser(c, { x: entreeX, y: g.basY, w: 2, h: 1 }, 'sol', 'seuil');
  faceNord(c, g);
  facade(c, g, entreeX);
  const fumoir = dehors(c, g, entreeX, objets);
  return {
    largeur: g.w,
    hauteur: g.h,
    cases: c,
    objets,
    postes,
    lieux: {
      cafe: { x: (sud.hall.x + 1.8) * TUILE, y: (g.basY - 1) * TUILE + 4 },
      reunion: { x: (sud.reunion.x + sud.reunion.w / 2) * TUILE, y: (sud.reunion.y + 6) * TUILE + 10 },
      bibliotheque: { x: (sud.biblio.x + 3) * TUILE, y: (g.basY - 1) * TUILE + 4 },
      terminal: { x: (sud.serveurs.x + sud.serveurs.w - 2) * TUILE, y: (sud.serveurs.y + 4) * TUILE + 26 },
      fumoir,
      entree: { x: (entreeX + 1) * TUILE, y: (g.basY + 4) * TUILE },
    },
    depart: { x: (entreeX + 1) * TUILE, y: (g.basY + 5) * TUILE },
  };
}
