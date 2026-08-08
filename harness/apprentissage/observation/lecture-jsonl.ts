/**
 * Responsabilité : lecture EN FLUX d'un transcript JSONL — jamais `readFileSync` entier
 * (SPEC-APPRENTISSAGE.md §5, C-1 `☠` : un transcript de mission longue dépasse facilement
 * la centaine de Mo). Une ligne = un objet JSON ; ligne illisible comptée et ignorée, type
 * inconnu toléré sans jamais lever (spec §2 F-2 : le CLI en ajoute au fil des versions).
 *
 * Conception inspirée de Hermes Agent (Nous Research) — MIT. Transposition indépendante en TypeScript.
 */

import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { executerAsync } from '../logger.ts';

/** Forme brute et partielle d'une ligne de transcript (SPEC §2 F-2) — tout est optionnel. */
export interface LigneTranscriptBrute {
  readonly type?: string;
  readonly uuid?: string;
  readonly parentUuid?: string | null;
  readonly isSidechain?: boolean;
  readonly sessionId?: string;
  readonly timestamp?: string;
  readonly cwd?: string;
  readonly gitBranch?: string;
  readonly message?: {
    readonly role?: string;
    readonly content?: unknown;
    readonly usage?: unknown;
  };
}

export interface StatistiquesLecture {
  readonly lignesLues: number;
  readonly lignesIllisibles: number;
}

export type ConsommateurLigne = (ligne: LigneTranscriptBrute) => void;

/**
 * Lit `chemin` ligne à ligne et invoque `consommer` pour chaque ligne JSON valide.
 * Une ligne vide est sautée ; une ligne illisible (JSON tronqué en fin d'écriture, cas
 * normal quand le CLI écrit encore — SPEC §5 C-1 `☠`) est comptée et ignorée, jamais levée.
 * Le flux garde une mémoire bornée quelle que soit la taille du fichier.
 */
export async function lireTranscriptEnFlux(
  chemin: string,
  consommer: ConsommateurLigne,
): Promise<StatistiquesLecture> {
  return executerAsync(
    'lireTranscriptEnFlux',
    async () => {
      const flux = createReadStream(chemin, { encoding: 'utf8' });
      const lignes = createInterface({ input: flux, crlfDelay: Infinity });
      let lignesLues = 0;
      let lignesIllisibles = 0;
      for await (const ligne of lignes) {
        if (ligne.length === 0) continue;
        lignesLues += 1;
        try {
          consommer(JSON.parse(ligne) as LigneTranscriptBrute);
        } catch {
          lignesIllisibles += 1;
        }
      }
      return { lignesLues, lignesIllisibles };
    },
    { chemin },
  );
}
