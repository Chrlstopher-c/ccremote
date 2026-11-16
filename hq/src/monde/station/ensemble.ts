// Responsabilité : la VUE STATION (pure, testable) — l'image d'ensemble de Chris (anneaux octogonaux autour de la salle
// centrale) sert de carte. Ses compartiments sont repérés une fois pour toutes (coordonnées relatives à l'image) ;
// chaque projet vivant reçoit un compartiment de son anneau : clients et agents sur l'anneau vert (intérieur), le
// reste sur l'anneau violet (extérieur). Les îlots (café, capsules, serre, serveurs, entrepôt) restent décoratifs.
import { categorieDe } from './categories';

export type Anneau = 'vert' | 'violet';

export interface Emplacement {
  x: number; // relatif à l'image (0..1)
  y: number;
  anneau: Anneau;
}

export interface Ilot {
  nom: string;
  x: number;
  y: number;
}

// Coordonnées mesurées sur public/station/ensemble.png (1664 × 928), ramenées en relatif.
const r = (x: number, y: number): { x: number; y: number } => ({ x: x / 1664, y: y / 928 });

export const CENTRALE = r(836, 445);

const v = (x: number, y: number, anneau: Anneau): Emplacement => ({ ...r(x, y), anneau });

export const EMPLACEMENTS: readonly Emplacement[] = [
  v(575, 400, 'vert'), v(705, 262, 'vert'), v(905, 290, 'vert'), v(1050, 360, 'vert'), v(1170, 650, 'vert'),
  v(1230, 585, 'vert'), v(800, 548, 'vert'),
  v(660, 155, 'violet'), v(775, 155, 'violet'), v(1210, 250, 'violet'), v(1330, 440, 'violet'),
  v(1305, 525, 'violet'), v(1000, 725, 'violet'), v(905, 700, 'violet'), v(360, 520, 'violet'),
];

export const ILOTS: readonly Ilot[] = [
  { nom: 'Café', ...r(395, 360) }, { nom: 'Café', ...r(1080, 430) }, { nom: 'Capsules', ...r(520, 200) },
  { nom: 'Capsules', ...r(440, 600) }, { nom: 'Serre', ...r(900, 150) }, { nom: 'Machines', ...r(1125, 180) },
  { nom: 'Entrepôt', ...r(740, 720) },
];

export interface Attribution {
  projet: string;
  emplacement: Emplacement;
}

const anneauDe = (projet: string): Anneau =>
  (['clients', 'agents'] as const).some((c) => c === categorieDe(projet).id) ? 'vert' : 'violet';

/** Un compartiment par projet, dans l'anneau de sa catégorie ; s'il est plein, dans l'autre ; au-delà, sans place. */
export function attribuer(projets: readonly string[]): Attribution[] {
  const libres = [...EMPLACEMENTS];
  const prendre = (a: Anneau): Emplacement | undefined => {
    const i = libres.findIndex((e) => e.anneau === a);
    const j = i >= 0 ? i : libres.findIndex(() => true);
    return j >= 0 ? libres.splice(j, 1)[0] : undefined;
  };
  const uniques = [...new Set(projets)];
  return uniques.flatMap((projet) => {
    const emplacement = prendre(anneauDe(projet));
    return emplacement ? [{ projet, emplacement }] : [];
  });
}
