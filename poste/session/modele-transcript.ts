// Responsabilité : le modèle réellement utilisé par une conversation, lu dans la fin de son transcript
// (dernier message assistant). Sert à la fiche d'une session fermée ou découverte, sans requête pour le dire.
import { closeSync, fstatSync, openSync, readSync } from 'node:fs';
import type { Logger } from 'pino';

const FENETRE_OCTETS = 2 * 1024 * 1024;

function lireFin(chemin: string): string {
  const fd = openSync(chemin, 'r');
  try {
    const taille = fstatSync(fd).size;
    const debut = Math.max(0, taille - FENETRE_OCTETS);
    const tampon = Buffer.alloc(taille - debut);
    readSync(fd, tampon, 0, tampon.length, debut);
    return tampon.toString('utf8');
  } finally {
    closeSync(fd);
  }
}

function modeleDeLigne(ligne: string): string | null {
  if (!ligne.includes('"type":"assistant"')) return null;
  try {
    const entree = JSON.parse(ligne) as { message?: { model?: unknown } };
    const modele = entree.message?.model;
    return typeof modele === 'string' && modele !== '' && !modele.startsWith('<') ? modele : null;
  } catch {
    return null; // ligne tronquée au début de la fenêtre : ignorée
  }
}

/** Modèle du dernier message assistant du transcript ; null si le transcript n'en a pas (ou se lit mal). */
export function modeleDuTranscript(chemin: string, journal: Logger): string | null {
  try {
    const lignes = lireFin(chemin).split('\n');
    for (let i = lignes.length - 1; i >= 0; i--) {
      const modele = modeleDeLigne(lignes[i] ?? '');
      if (modele !== null) return modele;
    }
    return null;
  } catch (erreur) {
    journal.warn({ err: erreur, chemin }, 'modèle du transcript non lu');
    return null;
  }
}
