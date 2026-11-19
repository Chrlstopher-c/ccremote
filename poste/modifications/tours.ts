// Responsabilité : les tours d'une session SDK. Capture : le contenu « avant » d'un fichier est gardé à sa première
// édition du tour (crochet PreToolUse) ; à la fin du tour le « après » est relu, les fichiers inchangés écartés, et le
// tour enregistré. Lecture, diff et annulation des tours enregistrés.
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, sep } from 'node:path';
import type { Logger } from 'pino';
import type { Diff, EtatFichier, FichierModifie, Modifications } from '../../commun/modifications.ts';
import { hunksUnifies } from './analyse-diff.ts';
import { comptesDeDeux, sortieDiffNoIndex } from './diff-no-index.ts';
import { DepotGit } from './git.ts';
import {
  dossierTemporaire,
  dossierTours,
  ecrireTour,
  type FichierEnregistre,
  listerTours,
  lireTour,
  type TourEnregistre,
} from './tours-disque.ts';

export const TAILLE_MAX_OCTETS = 5 * 1024 * 1024;
const TROP_GROS = 'trop-gros';
const ID_TOUR = /^[A-Za-z0-9-]{1,100}$/;

export interface FichiersTour {
  readonly tour: string;
  readonly fichiers: FichierModifie[];
}

export interface ParametresTours {
  readonly sessionId: string;
  readonly racine: string; // dossier de la session : chemins exposés relatifs à ce dossier
  readonly donnees: string;
  readonly journal: Logger;
}

export class ToursSession {
  private tourCourant: string | null = null;
  private avant = new Map<string, Buffer | null>();
  private readonly dossier: string;

  constructor(private readonly p: ParametresTours) {
    this.dossier = dossierTours(p.donnees, p.sessionId);
  }

  /** Garde le contenu « avant » d'un fichier à sa première édition du tour. */
  noterAvant(absolu: string): void {
    if (this.avant.has(absolu)) return;
    try {
      const contenu = lireContenu(absolu);
      if (contenu === TROP_GROS) {
        this.p.journal.info({ chemin: absolu }, 'fichier trop gros pour un tour : non relevé');
        return;
      }
      this.tourCourant ??= randomUUID();
      this.avant.set(absolu, contenu);
    } catch (erreur) {
      this.p.journal.warn({ err: erreur, chemin: absolu }, 'contenu avant édition illisible : non relevé');
    }
  }

  /** Fin de tour : enregistre les fichiers modifiés. Rend null s'il n'y en a aucun, ou si l'écriture échoue. */
  finirTour(): FichiersTour | null {
    const tour = this.tourCourant;
    const avant = this.avant;
    this.tourCourant = null;
    this.avant = new Map();
    if (tour === null) return null;
    const enregistres = [...avant].flatMap(([absolu, contenu]) => this.enregistrer(absolu, contenu));
    if (enregistres.length === 0) return null;
    try {
      ecrireTour(this.dossier, {
        tour,
        sessionId: this.p.sessionId,
        creeLe: new Date().toISOString(),
        annule: false,
        fichiers: enregistres,
      });
    } catch (erreur) {
      this.p.journal.error({ err: erreur, tour }, 'tour non enregistré');
      return null;
    }
    return { tour, fichiers: enregistres.map((f) => this.ficheDe(f)) };
  }

  async modifications(ref: string): Promise<Modifications> {
    const tour = this.charger(ref);
    const branche = await new DepotGit(this.p.racine, this.p.journal).brancheCourante();
    return { racine: this.p.racine, branche, fichiers: tour.fichiers.map((f) => this.ficheDe(f)) };
  }

  diff(ref: string, chemin: string): Diff {
    const tour = this.charger(ref);
    const fichier = tour.fichiers.find((f) => this.exposer(f.absolu) === chemin);
    if (!fichier) throw new Error(`fichier absent du tour : ${chemin}`);
    const etat = etatDe(fichier);
    if (fichier.binaire) return { chemin, etat, binaire: true, hunks: [] };
    const sortie = sortieDiffNoIndex(
      dossierTemporaire(this.p.donnees),
      depuisBase64(fichier.avant),
      depuisBase64(fichier.apres),
      ['-U3'],
      this.p.journal,
    );
    return { chemin, etat, binaire: false, hunks: hunksUnifies(sortie) };
  }

  /** Remet chaque fichier dans son état d'avant. Refus, sans rien toucher, si un fichier a changé depuis la fin. */
  annuler(ref: string): { tour: string; fichiers: number } {
    const tour = this.charger(ref);
    if (tour.annule) throw new Error('tour déjà annulé');
    const modifies = tour.fichiers.filter((f) => !this.inchangeDepuisLaFin(f)).map((f) => this.exposer(f.absolu));
    if (modifies.length > 0) throw new Error(`modifié depuis la fin du tour : ${modifies.join(', ')}`);
    try {
      for (const fichier of tour.fichiers) restaurer(fichier);
    } catch (erreur) {
      this.p.journal.error({ err: erreur, tour: tour.tour }, 'annulation interrompue');
      throw new Error(`annulation impossible : ${String(erreur)}`);
    }
    ecrireTour(this.dossier, { ...tour, annule: true, annuleLe: new Date().toISOString() });
    return { tour: tour.tour, fichiers: tour.fichiers.length };
  }

  private enregistrer(absolu: string, avant: Buffer | null): FichierEnregistre[] {
    try {
      const apres = lireContenu(absolu);
      if (apres === TROP_GROS) {
        this.p.journal.info({ chemin: absolu }, 'fichier trop gros après le tour : non relevé');
        return [];
      }
      if (memesOctets(avant, apres)) return [];
      const sortie = sortieDiffNoIndex(dossierTemporaire(this.p.donnees), avant, apres, ['--numstat'], this.p.journal);
      return [{ absolu, avant: versBase64(avant), apres: versBase64(apres), ...comptesDeDeux(sortie) }];
    } catch (erreur) {
      this.p.journal.warn({ err: erreur, chemin: absolu }, 'fichier du tour non relevé');
      return [];
    }
  }

  private inchangeDepuisLaFin(fichier: FichierEnregistre): boolean {
    try {
      const actuel = lireContenu(fichier.absolu);
      return actuel !== TROP_GROS && memesOctets(actuel, depuisBase64(fichier.apres));
    } catch (erreur) {
      this.p.journal.warn({ err: erreur, chemin: fichier.absolu }, 'fichier illisible : annulation refusée');
      return false;
    }
  }

  private charger(ref: string): TourEnregistre {
    const tour = ref === 'dernier' ? this.dernier() : ID_TOUR.test(ref) ? lireTour(this.dossier, ref) : null;
    if (!tour) throw new Error('tour inconnu');
    return tour;
  }

  private dernier(): TourEnregistre | null {
    return listerTours(this.dossier).sort((a, b) => b.creeLe.localeCompare(a.creeLe))[0] ?? null;
  }

  // Relatif au dossier de la session ; absolu pour un fichier qui en sort.
  private exposer(absolu: string): string {
    const relatif = relative(this.p.racine, absolu);
    const dehors = relatif === '' || isAbsolute(relatif) || relatif.split(sep)[0] === '..';
    return dehors ? absolu : relatif.split(sep).join('/');
  }

  private ficheDe(fichier: FichierEnregistre): FichierModifie {
    return {
      chemin: this.exposer(fichier.absolu),
      etat: etatDe(fichier),
      ajouts: fichier.ajouts,
      suppressions: fichier.suppressions,
      binaire: fichier.binaire,
    };
  }
}

function etatDe(fichier: FichierEnregistre): EtatFichier {
  if (fichier.avant === null) return 'ajoute';
  return fichier.apres === null ? 'supprime' : 'modifie';
}

// Contenu d'un fichier : null s'il est absent, TROP_GROS au-delà de la limite (il n'est pas relevé).
function lireContenu(chemin: string): Buffer | null | typeof TROP_GROS {
  const etat = statSync(chemin, { throwIfNoEntry: false });
  if (!etat) return null;
  if (etat.size > TAILLE_MAX_OCTETS) return TROP_GROS;
  return readFileSync(chemin);
}

function memesOctets(a: Buffer | null, b: Buffer | null): boolean {
  if (a === null || b === null) return a === b;
  return a.equals(b);
}

function versBase64(contenu: Buffer | null): string | null {
  return contenu === null ? null : contenu.toString('base64');
}

function depuisBase64(texte: string | null): Buffer | null {
  return texte === null ? null : Buffer.from(texte, 'base64');
}

function restaurer(fichier: FichierEnregistre): void {
  if (fichier.avant === null) {
    rmSync(fichier.absolu, { force: true });
    return;
  }
  mkdirSync(dirname(fichier.absolu), { recursive: true });
  writeFileSync(fichier.absolu, Buffer.from(fichier.avant, 'base64'));
}
