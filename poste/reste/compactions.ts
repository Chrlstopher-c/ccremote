// Responsabilité : les résumés de compaction d'une session (B5) — lignes `user` marquées `isCompactSummary` de son
// transcript JSONL, texte du message, plus ancien d'abord. Lecture seule ; transcript absent ou illisible = liste vide.
import { readFileSync } from 'node:fs';
import type { Logger } from 'pino';
import type { ResumeCompaction } from '../../commun/reste-lot2.ts';

// Forme exacte écrite par le CLI (JSON compact) : une citation dans un texte est échappée, elle ne correspond pas.
const MARQUEUR = '"isCompactSummary":true';

/** Les résumés d'un transcript (contenu complet), dans l'ordre du fichier. Une ligne illisible est ignorée. */
export function resumesDeTranscript(contenu: string, journal: Logger): ResumeCompaction[] {
  return contenu
    .split('\n')
    .filter((ligne) => ligne.includes(MARQUEUR))
    .flatMap((ligne) => resumeDeLigne(ligne, journal));
}

/** Les résumés du transcript au chemin donné ; null (session sans conversation) donne une liste vide. */
export function lireResumesCompaction(chemin: string | null, journal: Logger): ResumeCompaction[] {
  if (chemin === null) return [];
  try {
    return resumesDeTranscript(readFileSync(chemin, 'utf8'), journal);
  } catch (erreur) {
    if (!(typeof erreur === 'object' && erreur !== null && 'code' in erreur && erreur.code === 'ENOENT')) {
      journal.warn({ err: erreur, chemin }, 'transcript illisible : pas de résumé de compaction');
    }
    return [];
  }
}

function resumeDeLigne(ligne: string, journal: Logger): ResumeCompaction[] {
  let brut: unknown;
  try {
    brut = JSON.parse(ligne);
  } catch {
    journal.debug('ligne de compaction illisible : ignorée');
    return [];
  }
  if (typeof brut !== 'object' || brut === null) return [];
  const l = brut as { type?: unknown; isCompactSummary?: unknown; timestamp?: unknown; message?: unknown };
  if (l.type !== 'user' || l.isCompactSummary !== true) return [];
  const texte = texteDuMessage(l.message);
  return texte === '' ? [] : [{ ts: typeof l.timestamp === 'string' ? l.timestamp : '', texte }];
}

// Contenu chaîne, ou blocs `text` réunis par un saut de ligne (les autres blocs ne sont pas du texte de résumé).
function texteDuMessage(message: unknown): string {
  if (typeof message !== 'object' || message === null) return '';
  const contenu = (message as { content?: unknown }).content;
  if (typeof contenu === 'string') return contenu.trim();
  if (!Array.isArray(contenu)) return '';
  return contenu
    .flatMap((b: unknown) => {
      if (typeof b !== 'object' || b === null) return [];
      const bloc = b as { type?: unknown; text?: unknown };
      return bloc.type === 'text' && typeof bloc.text === 'string' ? [bloc.text] : [];
    })
    .join('\n')
    .trim();
}
