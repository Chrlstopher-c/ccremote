// Responsabilité : la dernière liste de sessions de chaque nœud apparié, gardée sur disque (dossier des secrets du
// nœud, 0600). Au redémarrage, les sessions d'une machine éteinte restent visibles (24/11 : la tour éteinte, Noctis
// mis à jour sur le portable → ses sessions avaient disparu jusqu'à son retour). Écriture regroupée, atomique.
import { chmodSync, existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import type { Logger } from 'pino';
import type { ResumeSession } from '../../commun/session.ts';

export interface NoeudMemorise {
  readonly nom: string;
  readonly machine: string;
  readonly sessions: readonly ResumeSession[];
}

export type ContenuMemoire = Readonly<Record<string, NoeudMemorise>>;

const DELAI_ECRITURE_MS = 2_000;

function estNoeud(v: unknown): v is NoeudMemorise {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>; // objet JSON vérifié non nul juste avant
  return typeof o['nom'] === 'string' && typeof o['machine'] === 'string' && Array.isArray(o['sessions']);
}

export class MemoireDistante {
  private contenu: Record<string, NoeudMemorise> = {};
  private minuterie: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly chemin: string,
    private readonly journal: Logger,
    private readonly delaiMs = DELAI_ECRITURE_MS,
  ) {
    this.contenu = this.lireFichier();
  }

  noeud(membre: string): NoeudMemorise | null {
    return this.contenu[membre] ?? null;
  }

  ecrire(contenu: ContenuMemoire): void {
    this.contenu = { ...contenu };
    if (this.minuterie !== null) return;
    this.minuterie = setTimeout(() => {
      this.minuterie = null;
      this.ecrireFichier();
    }, this.delaiMs);
    this.minuterie.unref?.();
  }

  /** Écriture immédiate (arrêt, tests). */
  vider(): void {
    if (this.minuterie !== null) clearTimeout(this.minuterie);
    this.minuterie = null;
    this.ecrireFichier();
  }

  private lireFichier(): Record<string, NoeudMemorise> {
    if (!existsSync(this.chemin)) return {};
    try {
      const brut: unknown = JSON.parse(readFileSync(this.chemin, 'utf8'));
      if (typeof brut !== 'object' || brut === null) return {};
      return Object.fromEntries(Object.entries(brut).filter(([, v]) => estNoeud(v)));
    } catch (erreur) {
      this.journal.warn({ err: erreur, chemin: this.chemin }, 'sessions des nœuds appariés illisibles : liste vide');
      return {};
    }
  }

  private ecrireFichier(): void {
    const provisoire = `${this.chemin}.neuf`;
    try {
      writeFileSync(provisoire, JSON.stringify(this.contenu), { mode: 0o600 });
      chmodSync(provisoire, 0o600);
      renameSync(provisoire, this.chemin);
    } catch (erreur) {
      this.journal.warn({ err: erreur, chemin: this.chemin }, 'sessions des nœuds appariés non enregistrées');
    }
  }
}
