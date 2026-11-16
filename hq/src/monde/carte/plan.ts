// Responsabilité : les types communs de la carte du monde (cases praticables, objets, postes des agents, lieux) et la
// taille d'une case. Les cartes sont construites par station/piece.ts (vue pièce). Pur : aucune notion de Phaser.

export const TUILE = 40; // une case = une plaque de sol du kit de la station (20 px d'art ×2)

export type Nature = 'dehors' | 'sol' | 'mur' | 'face'; // face : pied d'un mur du fond, on n'y marche pas
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
