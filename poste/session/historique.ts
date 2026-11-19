// Responsabilité : l'historique complet d'un transcript Claude Code, traduit en événements du fil avec leur horodatage
// d'origine. Sert à l'ouverture d'une session découverte ou adoptée : le relais n'a encore rien reçu de sa conversation.
// Les images des blocs sont stockées par le poste (`stockerImage`) ; sans lui, elles sont ignorées. Pur hors lecture.
import { readFileSync } from 'node:fs';
import type { Logger } from 'pino';
import type { Evenement } from '../../commun/session.ts';
import { TAILLE_MAX_FICHIER } from '../../commun/presentation.ts';
import { type ImageSdk, imagesDeContenu } from '../presentation/images.ts';
import type { Stockage } from '../presentation/stockage.ts';
import { brancheActive } from './branche.ts';
import { type Ligne, traduire } from './traduction.ts';

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

function resultatDOutil(l: Ligne): boolean {
  const contenu = l.message?.content;
  return Array.isArray(contenu) && contenu.some((b: unknown) => typeof b === 'object' && b !== null && (b as { type?: unknown }).type === 'tool_result');
}

function horodatage(l: Ligne, dernier: string): string {
  return typeof l.timestamp === 'string' && !Number.isNaN(Date.parse(l.timestamp)) ? l.timestamp : dernier;
}

/** Tous les événements de la branche active d'un transcript, dans l'ordre, sans les sous-agents (leur fil est à part). */
export function evenementsDuTranscript(contenu: string, stockerImage?: StockerImage): EvenementHorodate[] {
  const lignes = contenu
    .split('\n')
    .map(ligneDe)
    .filter((l): l is Ligne => l !== null);
  const sortie: EvenementHorodate[] = [];
  let dernier = EPOQUE;
  for (const l of brancheActive(lignes)) {
    const ts = horodatage(l, dernier);
    dernier = ts;
    for (const evt of traduire(l)) sortie.push({ ts, evt });
    if (stockerImage && l.type === 'user' && l.isSidechain !== true) {
      const origine = resultatDOutil(l) ? 'outil' : 'utilisateur';
      imagesDeContenu(l.message?.content).forEach((image, rang) => {
        const evt = stockerImage(image, rang, origine);
        if (evt) sortie.push({ ts, evt });
      });
    }
  }
  return sortie;
}

/** Lit le transcript entier ; un fichier illisible rend une liste vide (journalisé, la session reste ouvrable). */
export function lireHistorique(
  chemin: string,
  journal: Logger,
  stockerImage?: StockerImage,
): EvenementHorodate[] {
  try {
    return evenementsDuTranscript(readFileSync(chemin, 'utf8'), stockerImage);
  } catch (erreur) {
    journal.warn({ err: erreur, chemin }, 'historique du transcript illisible');
    return [];
  }
}

/** Stockeur d'images de l'historique : chaque image va dans le stockage de la session, comme en direct. */
export function stockeurImages(stockage: Stockage, sessionId: string, journal: Logger): StockerImage {
  return (image, rang, origine) => {
    try {
      const octets = Buffer.from(image.base64, 'base64');
      if (octets.length > TAILLE_MAX_FICHIER) {
        journal.warn({ session: sessionId, taille: octets.length }, 'image trop lourde pour le fil, écartée');
        return null;
      }
      const fichier = stockage.nouvelId();
      const nom = `image-${rang + 1}.${image.mime.split('/')[1] ?? 'png'}`;
      stockage.ecrire(sessionId, fichier, octets, { nom, mime: image.mime, taille: octets.length });
      return { type: 'image', fichier, nom, mime: image.mime, taille: octets.length, origine };
    } catch (erreur) {
      journal.error({ err: erreur, session: sessionId }, 'image de l’historique impossible à stocker');
      return null;
    }
  };
}
