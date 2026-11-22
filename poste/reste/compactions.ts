// Responsabilité : les résumés de compaction d'une session (B5) — lignes `user` marquées `isCompactSummary` de son
// transcript JSONL, texte du message, plus ancien d'abord, avec les jetons avant/après du marqueur `compact_boundary`
// qui les précède (même compaction que l'événement `compaction` du fil). Lecture seule ; transcript absent ou
// illisible = liste vide.
import { readFileSync } from 'node:fs';
import type { Logger } from 'pino';
import type { ResumeCompaction } from '../../commun/reste-lot2.ts';

// Forme exacte écrite par le CLI (JSON compact) : une citation dans un texte est échappée, elle ne correspond pas.
const MARQUEUR = '"isCompactSummary":true';
const FRONTIERE = '"compact_boundary"';

interface Jetons {
  readonly avant: number | null;
  readonly apres: number | null;
}

const SANS_JETONS: Jetons = { avant: null, apres: null };

/** Les résumés d'un transcript (contenu complet), dans l'ordre du fichier. Une ligne illisible est ignorée. */
export function resumesDeTranscript(contenu: string, journal: Logger): ResumeCompaction[] {
  const resumes: ResumeCompaction[] = [];
  let jetons: Jetons = SANS_JETONS;
  for (const ligne of contenu.split('\n')) {
    if (ligne.includes(FRONTIERE)) {
      jetons = jetonsDeFrontiere(ligne, journal) ?? SANS_JETONS;
    } else if (ligne.includes(MARQUEUR)) {
      resumes.push(...resumeDeLigne(ligne, journal, jetons));
      jetons = SANS_JETONS;
    }
  }
  return resumes;
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

function parseObjet(ligne: string, journal: Logger): Record<string, unknown> | null {
  try {
    const brut: unknown = JSON.parse(ligne);
    return typeof brut === 'object' && brut !== null ? (brut as Record<string, unknown>) : null;
  } catch {
    journal.debug('ligne de compaction illisible : ignorée');
    return null;
  }
}

/** Jetons avant et après d'un marqueur `compact_boundary` ; null si la ligne n'est pas un marqueur lisible. */
function jetonsDeFrontiere(ligne: string, journal: Logger): Jetons | null {
  const brut = parseObjet(ligne, journal);
  if (brut?.type !== 'system' || brut.subtype !== 'compact_boundary') return null;
  const meta = brut.compactMetadata;
  const m = typeof meta === 'object' && meta !== null ? (meta as Record<string, unknown>) : {};
  return { avant: nombreOuNull(m.preTokens), apres: nombreOuNull(m.postTokens) };
}

function nombreOuNull(valeur: unknown): number | null {
  return typeof valeur === 'number' && Number.isFinite(valeur) ? valeur : null;
}

function resumeDeLigne(ligne: string, journal: Logger, jetons: Jetons): ResumeCompaction[] {
  const brut = parseObjet(ligne, journal);
  if (brut === null) return [];
  const l = brut as { type?: unknown; isCompactSummary?: unknown; timestamp?: unknown; message?: unknown };
  if (l.type !== 'user' || l.isCompactSummary !== true) return [];
  const texte = texteDuMessage(l.message);
  if (texte === '') return [];
  return [{ ts: typeof l.timestamp === 'string' ? l.timestamp : '', texte, ...jetons }];
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
