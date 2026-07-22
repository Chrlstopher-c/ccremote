/**
 * Responsabilité : formes brutes des lignes SQLite du store et conversion vers le
 * domaine SDK (`SessionStoreEntry`, `SessionSummaryEntry`). Même séparation que
 * `control-plane/registre/lignes.ts` : SQLite ne connaît ni JSON typé ni camelCase.
 */

import type { SessionStoreEntry, SessionSummaryEntry } from '@anthropic-ai/claude-agent-sdk';

export interface LigneEntree {
  id: number;
  project_key: string;
  session_id: string;
  subpath: string;
  uuid: string | null;
  type: string;
  emetteur: string | null;
  donnee: string;
  ecrit_a: number;
}

export interface LigneSommaire {
  project_key: string;
  session_id: string;
  mtime: number;
  donnee: string;
}

export interface LigneDefaillance {
  id: number;
  project_key: string;
  session_id: string;
  subpath: string;
  cause: string;
  survenu_a: number;
}

/**
 * Reconstitue l'entrée telle qu'observée par le SDK. `donnee` est un JSON arbitraire
 * (E.3.1 : « entries are JSON-safe POJOs »), stocké et relu verbatim — l'égalité exigée
 * est une égalité profonde, jamais octet à octet (JSONB peut réordonner les clés, ce
 * `JSON.parse` aussi, et c'est explicitement toléré par le contrat SDK).
 */
export function versEntree(l: LigneEntree): SessionStoreEntry {
  // as : `donnee` est le JSON.stringify() d'une SessionStoreEntry passée à append() —
  // ce module ne produit ni n'accepte d'autre forme d'écriture dans cette colonne.
  return JSON.parse(l.donnee) as SessionStoreEntry;
}

/** `data` est un blob opaque du SDK (⚠ ALPHA) — jamais interprété, seulement relayé. */
export function versSommaire(l: LigneSommaire): SessionSummaryEntry {
  return {
    sessionId: l.session_id,
    mtime: l.mtime,
    // as : `donnee` est le JSON.stringify() du champ `data` opaque produit par
    // `foldSessionSummary` — jamais construit ni lu autrement dans ce module.
    data: JSON.parse(l.donnee) as Record<string, unknown>,
  };
}
