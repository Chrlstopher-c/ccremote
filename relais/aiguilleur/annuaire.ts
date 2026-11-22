// Responsabilité : les requêtes de l'annuaire — qui est membre, à quel propriétaire il appartient, s'il est révoqué,
// quels propriétaires sont liés par un duo. Seules les empreintes (SHA-256) des clés et des jetons sont gardées.
import { createHash } from 'node:crypto';
import type { Database } from 'bun:sqlite';
import type { GenreMembre } from '../../commun/aiguilleur.ts';

export interface Membre {
  readonly id: string;
  readonly genre: GenreMembre;
  readonly nom: string;
  readonly proprietaire: string;
  readonly empreinteCle: string;
  readonly creeLe: string;
  readonly revoqueLe: string | null;
}

export interface NouveauMembre {
  readonly id: string;
  readonly genre: GenreMembre;
  readonly nom: string;
  readonly proprietaire: string;
  readonly empreinteCle: string;
  readonly jetonEmpreinte: string;
}

interface LigneMembre {
  id: string;
  genre: GenreMembre;
  nom: string;
  proprietaire: string;
  empreinte_cle: string;
  cree_le: string;
  revoque_le: string | null;
}

/** SHA-256 hexadécimal : la forme sous laquelle un jeton ou une clé est gardée. */
export function empreinteSha256(texte: string): string {
  return createHash('sha256').update(texte).digest('hex');
}

function versMembre(l: LigneMembre): Membre {
  return {
    id: l.id,
    genre: l.genre,
    nom: l.nom,
    proprietaire: l.proprietaire,
    empreinteCle: l.empreinte_cle,
    creeLe: l.cree_le,
    revoqueLe: l.revoque_le,
  };
}

export class Annuaire {
  constructor(private readonly db: Database) {}

  /** Un code d'appairage (empreinte seulement) réservé à un propriétaire, valable jusqu'à `expireLe`. */
  creerCodeAppairage(proprietaire: string, empreinte: string, expireLe: string): void {
    this.db
      .query('INSERT INTO appairages (empreinte, proprietaire, cree_le, expire_le) VALUES (?, ?, ?, ?)')
      .run(empreinte, proprietaire, new Date().toISOString(), expireLe);
  }

  /** Consomme un code valable (usage unique) : rend son propriétaire, ou null si faux, expiré ou déjà pris. */
  consommerCodeAppairage(empreinte: string): string | null {
    const maintenant = new Date().toISOString();
    this.db.query('DELETE FROM appairages WHERE expire_le <= ?').run(maintenant);
    const ligne = this.db
      .query<{ proprietaire: string }, [string]>('DELETE FROM appairages WHERE empreinte = ? RETURNING proprietaire')
      .get(empreinte);
    return ligne?.proprietaire ?? null;
  }

  /** Enregistre un membre et son jeton (haché) d'un coup. */
  creerMembre(m: NouveauMembre): void {
    this.db.transaction(() => {
      this.db
        .query('INSERT INTO membres (id, genre, nom, proprietaire, empreinte_cle, cree_le) VALUES (?, ?, ?, ?, ?, ?)')
        .run(m.id, m.genre, m.nom.slice(0, 80), m.proprietaire, m.empreinteCle, new Date().toISOString());
      this.db
        .query('INSERT INTO jetons (empreinte, membre, cree_le) VALUES (?, ?, ?)')
        .run(m.jetonEmpreinte, m.id, new Date().toISOString());
    })();
  }

  membre(id: string): Membre | null {
    const l = this.db.query<LigneMembre, [string]>('SELECT * FROM membres WHERE id = ?').get(id);
    return l ? versMembre(l) : null;
  }

  membres(): Membre[] {
    return this.db.query<LigneMembre, []>('SELECT * FROM membres ORDER BY cree_le, id').all().map(versMembre);
  }

  /** Le membre qui porte ce jeton (empreinte), révoqué ou non ; null si le jeton n'existe plus. */
  membreDuJeton(jetonEmpreinte: string): Membre | null {
    const l = this.db
      .query<LigneMembre, [string]>('SELECT m.* FROM jetons j JOIN membres m ON m.id = j.membre WHERE j.empreinte = ?')
      .get(jetonEmpreinte);
    return l ? versMembre(l) : null;
  }

  /** Révoque un membre et supprime ses jetons. Rend false si le membre n'existe pas ou est déjà révoqué. */
  revoquer(id: string): boolean {
    return this.db.transaction(() => {
      const r = this.db
        .query('UPDATE membres SET revoque_le = ? WHERE id = ? AND revoque_le IS NULL')
        .run(new Date().toISOString(), id);
      this.db.query('DELETE FROM jetons WHERE membre = ?').run(id);
      return r.changes > 0;
    })();
  }

  /** Déclare un lien duo entre deux propriétaires (ordre indifférent, stocké trié). */
  lierDuo(a: string, b: string): void {
    const [x, y] = a < b ? [a, b] : [b, a];
    this.db
      .query('INSERT OR IGNORE INTO liens_duo (a, b, cree_le) VALUES (?, ?, ?)')
      .run(x, y, new Date().toISOString());
  }

  duoLie(a: string, b: string): boolean {
    const [x, y] = a < b ? [a, b] : [b, a];
    return this.db.query('SELECT 1 FROM liens_duo WHERE a = ? AND b = ?').get(x, y) !== null;
  }
}
