// Responsabilité : meubler les pièces du plan — bureaux des agents dans la pièce d'un projet, meubles des pièces
// communes. Règles (art/DIRECTION.md) : toute l'emprise d'un meuble est sur du sol ; un meuble adossé au mur du fond
// pose son emprise sur le premier rang de sol, devant la face du mur (qui est plus haute que lui : il ne dépasse
// jamais le dessus du mur). Pur, testable.
import { RANGS_FACE, TUILE, type Lieu, type Objet, type Poste, type Rect } from './plan';

export interface Communes {
  biblio: Rect;
  reunion: Rect;
  hall: Rect;
  serveurs: Rect;
}

/** Profondeur au sol de chaque meuble, en pixels du monde (`emprise` de public/objets.json). */
export type Emprises = Readonly<Record<string, number>>;

const PAR_AGENT = 3;
const EMPRISE_DEFAUT = 20;

const cx = (cases: number): number => cases * TUILE;

/** Haut du premier rang de sol d'une pièce : sous son mur du fond et les rangs de sa face. */
export const premierRang = (r: Rect): number => (r.y + 1 + RANGS_FACE) * TUILE;

/** Pied d'un meuble adossé au mur du fond de `r` : son emprise commence au premier rang de sol. */
export function adosse(r: Rect, nom: string, e: Emprises): number {
  return premierRang(r) + (e[nom] ?? EMPRISE_DEFAUT);
}

function contreLeMur(objets: Objet[], r: Rect, nom: string, x: number, h: Emprises): number {
  const y = adosse(r, nom, h);
  objets.push({ nom, x, y, bloque: true });
  return y;
}

/** Bureaux côte à côte contre le mur du fond, une plante dans le coin ; un poste par agent. */
export function meublerProjet(r: Rect, agents: number, objets: Objet[], h: Emprises): Poste[] {
  contreLeMur(objets, r, 'plante', cx(r.x + 1.5), h);
  if (r.w - 2 >= PAR_AGENT * agents + 5) contreLeMur(objets, r, 'plante', cx(r.x + r.w - 1.5), h);
  return Array.from({ length: agents }, (_, k) => {
    const x = cx(r.x + 2 + PAR_AGENT * k + 1.5);
    const y = contreLeMur(objets, r, 'bureau', x, h);
    return { projet: '', siege: { x, y: y + 24 }, debout: { x: x + 42, y: y + 58 } };
  });
}

function bibliotheque(r: Rect, objets: Objet[], h: Emprises): void {
  for (let x = r.x + 1.8; x < r.x + r.w - 5; x += 1.6) contreLeMur(objets, r, 'etagere', cx(x), h);
  objets.push({ nom: 'tapis', x: cx(r.x + r.w / 2), y: premierRang(r) + 3 * TUILE, bloque: false, auSol: true });
  objets.push({ nom: 'canape', x: cx(r.x + r.w / 2), y: premierRang(r) + 4 * TUILE + 30, bloque: true });
}

function salleReunion(r: Rect, objets: Objet[], h: Emprises): { x: number; y: number } {
  const table = { x: cx(r.x + r.w / 2), y: premierRang(r) + 2 * TUILE + 30 };
  objets.push({ nom: 'table', ...table, bloque: true });
  contreLeMur(objets, r, 'plante', cx(r.x + 1.5), h);
  objets.push({ nom: 'plante', x: cx(r.x + 1.5), y: premierRang(r) + 4 * TUILE + 28, bloque: true });
  return { x: table.x, y: table.y + 30 };
}

function hall(r: Rect, objets: Objet[], h: Emprises): void {
  contreLeMur(objets, r, 'cafe', cx(r.x + 1.8), h);
  contreLeMur(objets, r, 'distributeur', cx(r.x + 3.1), h);
  contreLeMur(objets, r, 'plante', cx(r.x + r.w - 1.5), h);
  objets.push({ nom: 'canape', x: cx(r.x + r.w - 3), y: premierRang(r) + 3 * TUILE, bloque: true });
}

function serveurs(r: Rect, objets: Objet[], h: Emprises): { x: number; y: number } {
  for (let x = r.x + 1.5; x < r.x + r.w - 4.6; x += 1.2) contreLeMur(objets, r, 'serveur', cx(x), h);
  const crt = { x: cx(r.x + 2), y: premierRang(r) + 3 * TUILE + 10 };
  objets.push({ nom: 'crt', ...crt, bloque: true });
  return { x: crt.x + 8, y: crt.y + 26 };
}

/** Meubles des pièces communes et les lieux où vont les personnages. */
export function meublerCommunes(
  c: Communes,
  objets: Objet[],
  h: Emprises,
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
