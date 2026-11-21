// Responsabilité : la trace des messages relayés entre sessions, gardée sur le poste
// (`<données>/relais/<session>.jsonl`, une ligne datée par message) et réinsérée à sa date dans l'historique de la
// session. Une erreur d'écriture ou de lecture est journalisée et ne fait jamais échouer l'historique.
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Logger } from 'pino';
import { z } from 'zod';
import { type AutreSession, type Evenement, type SensRelais } from '../../commun/session.ts';
import { Evenement as SchemaEvenement } from '../../commun/session.ts';
import type { EvenementHorodate } from '../session/historique.ts';
import type { SortieSession } from '../session/session-poste.ts';

const IDENTIFIANT = /^[A-Za-z0-9_-]{1,120}$/;
const LIGNE = z.object({ ts: z.string(), evt: SchemaEvenement });

export interface DemandeTrace {
  readonly sens: SensRelais;
  readonly autre: AutreSession;
  readonly texte: string;
}

export class TraceRelais {
  constructor(
    private readonly dossier: string,
    private readonly journal: Logger,
  ) {}

  /** Garde le message sur le poste, daté ; rend l'événement de fil, ou null si la trace n'a pas pu être écrite. */
  tracer(sessionId: string, demande: DemandeTrace, ts: string = new Date().toISOString()): EvenementHorodate | null {
    if (!IDENTIFIANT.test(sessionId)) return null;
    const evt: Evenement = { type: 'relais', sens: demande.sens, ...demande.autre, texte: demande.texte };
    try {
      mkdirSync(join(this.dossier, 'relais'), { recursive: true });
      appendFileSync(this.fichier(sessionId), `${JSON.stringify({ ts, evt })}\n`);
      return { ts, evt };
    } catch (erreur) {
      this.journal.error({ err: erreur, session: sessionId }, 'trace de relais non écrite');
      return null;
    }
  }

  /** Les traces de la session, dans l'ordre d'écriture ; une ligne illisible est écartée et journalisée. */
  lire(sessionId: string): EvenementHorodate[] {
    if (!IDENTIFIANT.test(sessionId) || !existsSync(this.fichier(sessionId))) return [];
    try {
      const lignes = readFileSync(this.fichier(sessionId), 'utf8').split('\n');
      return lignes.flatMap((ligne) => this.lireLigne(sessionId, ligne));
    } catch (erreur) {
      this.journal.warn({ err: erreur, session: sessionId }, 'trace de relais illisible');
      return [];
    }
  }

  /** L'historique d'une session avec ses traces réinsérées à leur date. */
  fusionner(sessionId: string, historique: readonly EvenementHorodate[]): EvenementHorodate[] {
    return fusionnerParDate(historique, this.lire(sessionId));
  }

  private lireLigne(sessionId: string, ligne: string): EvenementHorodate[] {
    if (ligne.trim() === '') return [];
    try {
      const lu = LIGNE.safeParse(JSON.parse(ligne));
      if (lu.success) return [lu.data];
      this.journal.warn({ session: sessionId }, 'trace de relais ignorée : forme inconnue');
    } catch (erreur) {
      this.journal.warn({ err: erreur, session: sessionId }, 'trace de relais ignorée : ligne illisible');
    }
    return [];
  }

  private fichier(sessionId: string): string {
    return join(this.dossier, 'relais', `${sessionId}.jsonl`);
  }
}

/**
 * Insère les traces dans l'historique à leur date : une trace prend sa place avant le premier événement du transcript
 * qui la suit. L'ordre d'écriture tient pour deux traces à la même date.
 */
export function fusionnerParDate(
  historique: readonly EvenementHorodate[],
  traces: readonly EvenementHorodate[],
): EvenementHorodate[] {
  const ordre = [...traces].sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
  const sortie: EvenementHorodate[] = [];
  let i = 0;
  for (const h of historique) {
    for (let t = ordre[i]; t && t.ts < h.ts; t = ordre[i]) {
      sortie.push(t);
      i += 1;
    }
    sortie.push(h);
  }
  return [...sortie, ...ordre.slice(i)];
}

/** Le même canal de sortie, dont l'historique repasse par la trace de relais avant d'être émis. */
export function avecTraceRelais(sortie: SortieSession, trace: TraceRelais): SortieSession {
  return {
    ...sortie,
    historique: (id, evenements, direct) => sortie.historique?.(id, trace.fusionner(id, evenements), direct),
  };
}
