/**
 * Responsabilité : sidecar de sommaire (H.3.2), maintenu via `foldSessionSummary` du SDK.
 *
 * `foldSessionSummary` est pure (import direct du SDK, ⚠ ALPHA) : la maîtrise de la
 * concurrence et l'horodatage sont explicitement délégués au store par la documentation.
 * Ce module porte les deux : le cycle lire-plier-écrire est appelé à l'intérieur de la
 * transaction SQLite ouverte par l'appelant (adaptateur.ts), ce qui sérialise les écritures
 * concurrentes sur une même session sans verrou applicatif supplémentaire (SQLite ne laisse
 * qu'un seul écrivain progresser à la fois). `mtime` est estampillé ici avec l'horloge du
 * store, jamais dérivé des horodatages d'entrées (panne #31) — et gardé monotone par clé
 * pour qu'une seconde écriture dans la même milliseconde ne produise jamais un mtime égal
 * ou antérieur, ce qui casserait tout contrôle de fraîcheur en aval.
 */

import type { Database } from 'bun:sqlite';
import { foldSessionSummary } from '@anthropic-ai/claude-agent-sdk';
import type { SessionKey, SessionStoreEntry, SessionSummaryEntry } from '@anthropic-ai/claude-agent-sdk';
import { executer } from './journal.ts';
import { versSommaire, type LigneSommaire } from './lignes.ts';

export class DepotSommaire {
  constructor(private readonly db: Database) {}

  /**
   * Plie le lot dans le sommaire courant et persiste verbatim. Appelée UNIQUEMENT pour
   * le transcript principal (l'adaptateur filtre les sous-chemins en amont) : les
   * transcripts de sous-agents n'ont pas de sommaire, comme dans la référence du SDK.
   */
  public plierEtEcrire(
    cle: SessionKey,
    entrees: readonly SessionStoreEntry[],
    estampilleSuggeree: number,
  ): void {
    executer(
      'sommaire.plierEtEcrire',
      () => {
        const precedent = this.#lireBrut(cle.projectKey, cle.sessionId);
        const mtime = this.#mtimeMonotone(precedent?.mtime, estampilleSuggeree);
        const plie = foldSessionSummary(precedent, cle, [...entrees], { mtime });
        this.#ecrire(cle.projectKey, cle.sessionId, plie);
      },
      { projetCle: cle.projectKey, sessionId: cle.sessionId },
    );
  }

  public lire(projetCle: string, sessionId: string): SessionSummaryEntry | null {
    return executer(
      'sommaire.lire',
      () => {
        const ligne = this.#lireLigne(projetCle, sessionId);
        return ligne ? versSommaire(ligne) : null;
      },
      { projetCle, sessionId },
    );
  }

  public listerParProjet(projetCle: string): readonly SessionSummaryEntry[] {
    return executer(
      'sommaire.listerParProjet',
      () => {
        const lignes = this.db
          .query<LigneSommaire, [string]>('SELECT * FROM session_sommaire WHERE project_key = ?')
          .all(projetCle);
        return lignes.map(versSommaire);
      },
      { projetCle },
    );
  }

  public supprimer(projetCle: string, sessionId: string): void {
    executer(
      'sommaire.supprimer',
      () => {
        this.db
          .query('DELETE FROM session_sommaire WHERE project_key = ? AND session_id = ?')
          .run(projetCle, sessionId);
      },
      { projetCle, sessionId },
    );
  }

  #lireLigne(projetCle: string, sessionId: string): LigneSommaire | null {
    return this.db
      .query<LigneSommaire, [string, string]>(
        'SELECT * FROM session_sommaire WHERE project_key = ? AND session_id = ?',
      )
      .get(projetCle, sessionId);
  }

  /** Reconvertit la ligne stockée dans la forme attendue par `foldSessionSummary` (`prev`). */
  #lireBrut(projetCle: string, sessionId: string): SessionSummaryEntry | undefined {
    const ligne = this.#lireLigne(projetCle, sessionId);
    return ligne ? versSommaire(ligne) : undefined;
  }

  #mtimeMonotone(precedent: number | undefined, suggere: number): number {
    if (precedent === undefined) return suggere;
    return Math.max(suggere, precedent + 1);
  }

  #ecrire(projetCle: string, sessionId: string, sommaire: SessionSummaryEntry): void {
    this.db
      .query(
        `INSERT INTO session_sommaire (project_key, session_id, mtime, donnee)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(project_key, session_id) DO UPDATE SET mtime = excluded.mtime, donnee = excluded.donnee`,
      )
      .run(projetCle, sessionId, sommaire.mtime, JSON.stringify(sommaire.data));
  }
}
