// Responsabilité : lire un transcript qui grossit sans le relire en entier. La base (octets lus, branche connue,
// traduction en cours) vient d'une lecture complète ; ensuite un passage ne traduit que les lignes complètes ajoutées
// en queue. Une réécriture, un fichier tronqué ou une branche cassée rendent `null` : relecture complète requise.
import { closeSync, openSync, readSync, type Stats, statSync } from 'node:fs';
import type { Logger } from 'pino';
import { brancheActive, type EtatChaine, etatDeBranche, prolongerBranche } from './branche.ts';
import type { LireImageChemin } from '../presentation/images-chemin.ts';
import { type EvenementHorodate, lignesDe, type StockerImage, TraducteurHistorique } from './historique.ts';
import type { Ligne } from './traduction.ts';

interface Base {
  octets: number; // position juste après la dernière ligne complète lue
  readonly ino: number | null; // identité du fichier au moment de la base (null : absent alors)
  readonly etat: EtatChaine;
  readonly traducteur: TraducteurHistorique;
}

function statOuNull(chemin: string, journal: Logger): Stats | null {
  try {
    return statSync(chemin, { throwIfNoEntry: false }) ?? null;
  } catch (erreur) {
    journal.warn({ err: erreur, chemin }, 'transcript inaccessible');
    return null;
  }
}

function lireDepuis(chemin: string, depuis: number, longueur: number, journal: Logger): Buffer | null {
  const tampon = Buffer.alloc(longueur);
  let fd: number | null = null;
  try {
    fd = openSync(chemin, 'r');
    return tampon.subarray(0, readSync(fd, tampon, 0, longueur, depuis));
  } catch (erreur) {
    journal.warn({ err: erreur, chemin }, 'transcript illisible');
    return null;
  } finally {
    if (fd !== null) closeSync(fd);
  }
}

// Première vue : seule la fin du transcript est lue (la fin de branche y est, sinon elle est tenue pour inconnue).
const FENETRE_FIN = 512 * 1024;

export class LectureIncrementale {
  private base: Base | null = null;

  constructor(
    readonly chemin: string,
    private readonly journal: Logger,
    private readonly stockerImage?: StockerImage,
    private readonly lireChemin?: LireImageChemin,
  ) {}

  get etablie(): boolean {
    return this.base !== null;
  }

  /** Première vue sans relecture : la base est la fin du fichier, sa fin de branche lue dans la dernière portion. */
  etablirALaFin(): void {
    const info = statOuNull(this.chemin, this.journal);
    if (info === null) {
      this.base = this.baseDe(0, null, []);
      return;
    }
    const debut = Math.max(0, info.size - FENETRE_FIN);
    const queue = lireDepuis(this.chemin, debut, info.size - debut, this.journal);
    if (queue === null) {
      this.base = null;
      return;
    }
    const fin = queue.lastIndexOf(0x0a) + 1;
    if (fin === 0 && debut > 0) {
      this.relireTout();
      return;
    }
    this.base = this.baseDe(debut + fin, info.ino, lignesDe(queue.subarray(0, fin).toString('utf8')));
  }

  /** Lecture complète : pose la base et rend les événements de la branche active. Fichier absent : base vide. */
  relireTout(): EvenementHorodate[] {
    const info = statOuNull(this.chemin, this.journal);
    const contenu = info === null ? Buffer.alloc(0) : lireDepuis(this.chemin, 0, info.size, this.journal);
    if (contenu === null) {
      this.base = null;
      return [];
    }
    const fin = contenu.lastIndexOf(0x0a) + 1;
    const lignes = lignesDe(contenu.subarray(0, fin).toString('utf8'));
    const base = this.baseDe(fin, info?.ino ?? null, lignes);
    this.base = base;
    return brancheActive(lignes).flatMap((l) => base.traducteur.evenements(l));
  }

  private baseDe(octets: number, ino: number | null, lignes: readonly Ligne[]): Base {
    const traducteur = new TraducteurHistorique(this.stockerImage, this.lireChemin);
    return { octets, ino, etat: etatDeBranche(lignes), traducteur };
  }

  /** Événements ajoutés depuis la base : [] s'il n'y a rien de neuf, `null` si une relecture complète est requise. */
  ajout(): EvenementHorodate[] | null {
    const base = this.base;
    if (base === null) return null;
    const info = statOuNull(this.chemin, this.journal);
    if (info === null) return [];
    if ((base.ino !== null && info.ino !== base.ino) || info.size < base.octets) return null;
    if (info.size === base.octets) return [];
    const neuf = lireDepuis(this.chemin, base.octets, info.size - base.octets, this.journal);
    if (neuf === null) return [];
    const fin = neuf.lastIndexOf(0x0a) + 1;
    if (fin === 0) return [];
    const lignes = lignesDe(neuf.subarray(0, fin).toString('utf8'));
    if (!prolongerBranche(base.etat, lignes)) return null;
    base.octets += fin;
    return lignes.flatMap((l) => base.traducteur.evenements(l));
  }
}
