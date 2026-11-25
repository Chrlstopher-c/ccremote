// Responsabilité : l'historique (première page de `evenements`) d'une session d'un nœud apparié, gardé sur disque
// (dossier des secrets du nœud, 0600) pour rester lisible quand ce nœud est éteint. 40 sessions au plus (les plus
// récemment lues), 2 Mo au plus par session. Même principe que `memoire-distante.ts` : écriture regroupée, atomique.
import { chmodSync, existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import type { Logger } from 'pino';

export const MAX_SESSIONS_HISTORIQUE = 40;
export const TAILLE_MAX_HISTORIQUE_OCTETS = 2 * 1024 * 1024;

const DELAI_ECRITURE_MS = 2_000;

export interface EntreeHistorique {
  readonly session: string;
  readonly corps: string;
}

function estEntree(v: unknown): v is EntreeHistorique {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>; // objet JSON vérifié non nul juste avant
  return typeof o['session'] === 'string' && typeof o['corps'] === 'string';
}

export class HistoriqueDistant {
  // Ordre : la moins récemment lue en tête, la plus récente en queue.
  private entrees: EntreeHistorique[];
  private minuterie: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly chemin: string,
    private readonly journal: Logger,
    private readonly delaiMs = DELAI_ECRITURE_MS,
  ) {
    this.entrees = this.lireFichier();
  }

  /** Garde le corps d'une réponse réussie de `evenements` ; au-delà de 2 Mo, la session n'est pas gardée. */
  garder(session: string, corps: string): void {
    const sansCettePage = this.entrees.filter((e) => e.session !== session);
    const octets = Buffer.byteLength(corps);
    if (octets > TAILLE_MAX_HISTORIQUE_OCTETS) {
      this.journal.debug({ session, octets }, 'historique d’un nœud trop grand : non gardé');
      this.entrees = sansCettePage;
    } else {
      this.entrees = [...sansCettePage, { session, corps }].slice(-MAX_SESSIONS_HISTORIQUE);
    }
    this.planifier();
  }

  /** L'historique gardé de la session (elle devient la plus récente), ou null. */
  lire(session: string): string | null {
    const entree = this.entrees.find((e) => e.session === session);
    if (!entree) return null;
    this.entrees = [...this.entrees.filter((e) => e !== entree), entree];
    this.planifier();
    return entree.corps;
  }

  /** Écriture immédiate (arrêt, tests). */
  vider(): void {
    if (this.minuterie !== null) clearTimeout(this.minuterie);
    this.minuterie = null;
    this.ecrireFichier();
  }

  private planifier(): void {
    if (this.minuterie !== null) return;
    this.minuterie = setTimeout(() => {
      this.minuterie = null;
      this.ecrireFichier();
    }, this.delaiMs);
    this.minuterie.unref?.();
  }

  private lireFichier(): EntreeHistorique[] {
    if (!existsSync(this.chemin)) return [];
    try {
      const brut: unknown = JSON.parse(readFileSync(this.chemin, 'utf8'));
      if (!Array.isArray(brut)) return [];
      return brut.filter(estEntree).slice(-MAX_SESSIONS_HISTORIQUE);
    } catch (erreur) {
      this.journal.warn({ err: erreur, chemin: this.chemin }, 'historique des nœuds appariés illisible : ignoré');
      return [];
    }
  }

  private ecrireFichier(): void {
    const provisoire = `${this.chemin}.neuf`;
    try {
      writeFileSync(provisoire, JSON.stringify(this.entrees), { mode: 0o600 });
      chmodSync(provisoire, 0o600);
      renameSync(provisoire, this.chemin);
    } catch (erreur) {
      this.journal.warn({ err: erreur, chemin: this.chemin }, 'historique des nœuds appariés non enregistré');
    }
  }
}
