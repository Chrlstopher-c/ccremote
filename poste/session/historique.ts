// Responsabilité : l'historique d'un transcript Claude Code, traduit en événements du fil avec leur horodatage d'origine.
// Sert à l'ouverture d'une session découverte ou adoptée (relecture complète) et à la suite de ses écritures (le
// traducteur garde son horodatage courant entre deux passages). Les images des blocs sont stockées par le poste
// (`stockerImage`) ; sans lui, elles sont ignorées. Pur hors lecture.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { Logger } from 'pino';
import type { Evenement } from '../../commun/session.ts';
import { TAILLE_MAX_FICHIER } from '../../commun/presentation.ts';
import { type ImageSdk, imagesDeContenu } from '../presentation/images.ts';
import type { Stockage } from '../presentation/stockage.ts';
import { brancheActive } from './branche.ts';
import { CompteTours } from './tours-transcript.ts';
import { type Ligne, messageEnFile, traduire } from './traduction.ts';

export interface EvenementHorodate {
  readonly ts: string;
  readonly evt: Evenement;
}

export type StockerImage = (image: ImageSdk, rang: number, origine: 'outil' | 'utilisateur') => Evenement | null;

const EPOQUE = new Date(0).toISOString();

// Une ligne invalide (écriture en cours, corruption) est ignorée ; le reste du transcript reste lisible.
function ligneDe(texte: string): Ligne | null {
  try {
    const v: unknown = JSON.parse(texte);
    return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Ligne) : null;
  } catch {
    return null;
  }
}

/** Lignes d'un texte de transcript, sans les lignes invalides. */
export function lignesDe(texte: string): Ligne[] {
  return texte
    .split('\n')
    .map(ligneDe)
    .filter((l): l is Ligne => l !== null);
}

function resultatDOutil(l: Ligne): boolean {
  const contenu = l.message?.content;
  return Array.isArray(contenu) && contenu.some((b: unknown) => typeof b === 'object' && b !== null && (b as { type?: unknown }).type === 'tool_result');
}

function horodatage(l: Ligne, dernier: string): string {
  return typeof l.timestamp === 'string' && !Number.isNaN(Date.parse(l.timestamp)) ? l.timestamp : dernier;
}

/** Traduit les lignes d'une branche, une à une et dans l'ordre : sans horodatage, une ligne reprend la précédente. */
export class TraducteurHistorique {
  private dernier = EPOQUE;
  private readonly tours = new CompteTours(); // état d'un tour à l'autre : gardé entre les passages du suivi

  constructor(private readonly stockerImage?: StockerImage) {}

  evenements(l: Ligne): EvenementHorodate[] {
    const ts = horodatage(l, this.dernier);
    this.dernier = ts;
    const sortie: EvenementHorodate[] = [...traduire(l), ...this.tours.ligne(l)].map((evt) => ({ ts, evt }));
    const stocker = this.stockerImage;
    const enFile = l.type === 'attachment' && messageEnFile(l);
    if (stocker && (l.type === 'user' || enFile) && l.isSidechain !== true) {
      const origine = !enFile && resultatDOutil(l) ? 'outil' : 'utilisateur';
      const contenu = enFile ? l.attachment?.prompt : l.message?.content;
      imagesDeContenu(contenu).forEach((image, rang) => {
        const evt = stocker(image, rang, origine);
        if (evt) sortie.push({ ts, evt });
      });
    }
    return sortie;
  }
}

/** Tous les événements de la branche active d'un transcript, dans l'ordre, sans les sous-agents (leur fil est à part). */
export function evenementsDuTranscript(contenu: string, stockerImage?: StockerImage): EvenementHorodate[] {
  const traducteur = new TraducteurHistorique(stockerImage);
  return brancheActive(lignesDe(contenu)).flatMap((l) => traducteur.evenements(l));
}

/** Lit le transcript entier ; un fichier illisible rend une liste vide (journalisé, la session reste ouvrable). */
export function lireHistorique(chemin: string, journal: Logger, stockerImage?: StockerImage): EvenementHorodate[] {
  try {
    return evenementsDuTranscript(readFileSync(chemin, 'utf8'), stockerImage);
  } catch (erreur) {
    journal.warn({ err: erreur, chemin }, 'historique du transcript illisible');
    return [];
  }
}

/** Identifiant d'une image tiré de son contenu : la même image relue donne le même fichier et le même événement. */
export function identifiantImage(octets: Uint8Array): string {
  return createHash('sha256').update(octets).digest('hex').slice(0, 16);
}

/** Stockeur d'images de l'historique : une image va dans le stockage de la session, une seule fois (même contenu). */
export function stockeurImages(stockage: Stockage, sessionId: string, journal: Logger): StockerImage {
  return (image, rang, origine) => {
    try {
      const octets = Buffer.from(image.base64, 'base64');
      if (octets.length > TAILLE_MAX_FICHIER) {
        journal.warn({ session: sessionId, taille: octets.length }, 'image trop lourde pour le fil, écartée');
        return null;
      }
      const fichier = identifiantImage(octets);
      const nom = `image-${rang + 1}.${image.mime.split('/')[1] ?? 'png'}`;
      if (!stockage.existe(sessionId, fichier)) {
        stockage.ecrire(sessionId, fichier, octets, { nom, mime: image.mime, taille: octets.length });
      }
      return { type: 'image', fichier, nom, mime: image.mime, taille: octets.length, origine };
    } catch (erreur) {
      journal.error({ err: erreur, session: sessionId }, 'image de l’historique impossible à stocker');
      return null;
    }
  };
}
