// Responsabilité : meubler les pièces du plan — bureaux des agents dans la pièce d'un projet, meubles des pièces
// communes. Règles (art/DIRECTION.md) : toute l'emprise d'un meuble est sur du sol ; un meuble adossé au mur du fond
// ne dépasse JAMAIS le dessus du mur (son sommet s'arrête sur la face, comme dans The Escapists) : il est donc posé
// d'après la hauteur réelle de son image. Pur, testable.
import { TUILE, type Lieu, type Objet, type Poste, type Rect } from './plan';

export interface Communes {
  biblio: Rect;
  reunion: Rect;
  hall: Rect;
  serveurs: Rect;
}

/** Hauteur dessinée de chaque meuble, en pixels du monde (public/objets.json). */
export type Hauteurs = Readonly<Record<string, number>>;

const PAR_AGENT = 3;
const BAS_COIFFE = 14; // bas du dessus d'un mur sous le haut de sa case (7 px d'art × 2)
const HAUTEUR_DEFAUT = 64;

const cx = (cases: number): number => cases * TUILE;

/** Pied d'un meuble adossé au mur du fond de `r` : son sommet touche le bas du dessus du mur, sans le chevaucher. */
export function adosse(r: Rect, nom: string, h: Hauteurs): number {
  return r.y * TUILE + BAS_COIFFE + (h[nom] ?? HAUTEUR_DEFAUT);
}

function contreLeMur(objets: Objet[], r: Rect, nom: string, x: number, h: Hauteurs): number {
  const y = adosse(r, nom, h);
  objets.push({ nom, x, y, bloque: true });
  return y;
}

/** Bureaux côte à côte contre le mur du fond, une plante dans le coin ; un poste par agent. */
export function meublerProjet(r: Rect, agents: number, objets: Objet[], h: Hauteurs): Poste[] {
  contreLeMur(objets, r, 'plante', cx(r.x + 1.5), h);
  if (r.w - 2 >= PAR_AGENT * agents + 5) contreLeMur(objets, r, 'plante', cx(r.x + r.w - 1.5), h);
  return Array.from({ length: agents }, (_, k) => {
    const x = cx(r.x + 2 + PAR_AGENT * k + 1.5);
    const y = contreLeMur(objets, r, 'bureau', x, h);
    return { projet: '', siege: { x, y: y + 24 }, debout: { x: x + 42, y: y + 58 } };
  });
}

function bibliotheque(r: Rect, objets: Objet[], h: Hauteurs): void {
  for (let x = r.x + 1.8; x < r.x + r.w - 5; x += 1.6) contreLeMur(objets, r, 'etagere', cx(x), h);
  objets.push({ nom: 'tapis', x: cx(r.x + r.w / 2), y: cx(r.y + 5), bloque: false, auSol: true });
  objets.push({ nom: 'canape', x: cx(r.x + r.w / 2), y: cx(r.y + 6) - 2, bloque: true });
}

function salleReunion(r: Rect, objets: Objet[], h: Hauteurs): { x: number; y: number } {
  const table = { x: cx(r.x + r.w / 2), y: cx(r.y + 4) + 24 };
  objets.push({ nom: 'table', ...table, bloque: true });
  contreLeMur(objets, r, 'plante', cx(r.x + 1.5), h);
  objets.push({ nom: 'plante', x: cx(r.x + 1.5), y: cx(r.y + 6) + 4, bloque: true });
  return { x: table.x, y: table.y + 30 };
}

function hall(r: Rect, objets: Objet[], h: Hauteurs): void {
  contreLeMur(objets, r, 'cafe', cx(r.x + 1.8), h);
  contreLeMur(objets, r, 'distributeur', cx(r.x + 3.1), h);
  contreLeMur(objets, r, 'plante', cx(r.x + r.w - 1.5), h);
  objets.push({ nom: 'canape', x: cx(r.x + r.w - 3), y: cx(r.y + 5), bloque: true });
}

function serveurs(r: Rect, objets: Objet[], h: Hauteurs): { x: number; y: number } {
  for (let x = r.x + 1.5; x < r.x + r.w - 4.6; x += 1.2) contreLeMur(objets, r, 'serveur', cx(x), h);
  const crt = { x: cx(r.x + 2), y: cx(r.y + 5) + 16 };
  objets.push({ nom: 'crt', ...crt, bloque: true });
  return { x: crt.x + 8, y: crt.y + 26 };
}

/** Meubles des pièces communes et les lieux où vont les personnages. */
export function meublerCommunes(
  c: Communes,
  objets: Objet[],
  h: Hauteurs,
): Record<Exclude<Lieu, 'fumoir' | 'entree'>, { x: number; y: number }> {
  bibliotheque(c.biblio, objets, h);
  const reunion = salleReunion(c.reunion, objets, h);
  hall(c.hall, objets, h);
  const terminal = serveurs(c.serveurs, objets, h);
  return {
    cafe: { x: cx(c.hall.x + 2.5), y: adosse(c.hall, 'cafe', h) + 34 },
    reunion,
    bibliotheque: { x: cx(c.biblio.x + 3), y: adosse(c.biblio, 'etagere', h) + 36 },
    terminal,
  };
}
