/**
 * Responsabilité : persistance brute des entrées de transcript (E.3.1, E.3.2).
 * Aucune notion de sommaire ni de politique d'échec ici — uniquement la table
 * `session_entree` : upsert par `uuid`, ordre d'appel, sous-clés, suppression.
 */

import type { Database } from 'bun:sqlite';
import type { SessionStoreEntry } from '@anthropic-ai/claude-agent-sdk';
import { executer } from './journal.ts';
import { versEntree, type LigneEntree } from './lignes.ts';
import { estTranscriptPrincipal } from './clef.ts';

export class DepotEntrees {
  constructor(private readonly db: Database) {}

  /**
   * Upsert par `uuid` (E.3.2) : une entrée déjà vue met à jour sa ligne en place —
   * son `id` ne change pas, donc l'ordre chronologique d'origine est préservé même
   * après réécriture. Sans `uuid`, toujours un ajout brut, sans déduplication.
   */
  public ajouter(
    projetCle: string,
    sessionId: string,
    sousChemin: string,
    entrees: readonly SessionStoreEntry[],
    ecritA: number,
  ): void {
    executer(
      'entrees.ajouter',
      () => {
        for (const entree of entrees) {
          this.#upsertUne(projetCle, sessionId, sousChemin, entree, ecritA);
        }
      },
      { projetCle, sessionId, sousChemin, taille: entrees.length },
    );
  }

  public charger(
    projetCle: string,
    sessionId: string,
    sousChemin: string,
  ): readonly SessionStoreEntry[] | null {
    return executer(
      'entrees.charger',
      () => {
        const lignes = this.db
          .query<LigneEntree, [string, string, string]>(
            `SELECT * FROM session_entree
              WHERE project_key = ? AND session_id = ? AND subpath = ?
              ORDER BY id`,
          )
          .all(projetCle, sessionId, sousChemin);
        // `null` pour une clé jamais écrite (contrat SDK) ; ce store ne distingue pas
        // "jamais écrite" de "vidée après delete" — toléré explicitement par la doc
        // (elle cite Redis LRANGE comme backend équivalent sur ce point).
        if (lignes.length === 0) return null;
        return lignes.map(versEntree);
      },
      { projetCle, sessionId, sousChemin },
    );
  }

  /** Sous-chemins non vides pour une session — transcripts de sous-agents (panne #4). */
  public listerSousCles(projetCle: string, sessionId: string): readonly string[] {
    return executer(
      'entrees.listerSousCles',
      () => {
        const lignes = this.db
          .query<{ subpath: string }, [string, string, string]>(
            `SELECT DISTINCT subpath FROM session_entree
              WHERE project_key = ? AND session_id = ? AND subpath != ?`,
          )
          .all(projetCle, sessionId, '');
        return lignes.map((l) => l.subpath);
      },
      { projetCle, sessionId },
    );
  }

  public supprimer(projetCle: string, sessionId: string, sousChemin: string): void {
    executer(
      'entrees.supprimer',
      () => {
        this.db
          .query('DELETE FROM session_entree WHERE project_key = ? AND session_id = ? AND subpath = ?')
          .run(projetCle, sessionId, sousChemin);
      },
      { projetCle, sessionId, sousChemin },
    );
  }

  /** Horodatage de la dernière écriture réussie sur cette clé — signal de fraîcheur du miroir. */
  public derniereEcritureA(projetCle: string, sessionId: string, sousChemin: string): number | null {
    return executer(
      'entrees.derniereEcritureA',
      () => {
        const ligne = this.db
          .query<{ m: number | null }, [string, string, string]>(
            `SELECT MAX(ecrit_a) AS m FROM session_entree
              WHERE project_key = ? AND session_id = ? AND subpath = ?`,
          )
          .get(projetCle, sessionId, sousChemin);
        return ligne?.m ?? null;
      },
      { projetCle, sessionId, sousChemin },
    );
  }

  /** Utilisé par le sommaire : ne fold que le transcript principal (le SDK fait pareil). */
  public estPrincipal(sousChemin: string): boolean {
    return estTranscriptPrincipal(sousChemin);
  }

  #upsertUne(
    projetCle: string,
    sessionId: string,
    sousChemin: string,
    entree: SessionStoreEntry,
    ecritA: number,
  ): void {
    const donnee = JSON.stringify(entree);
    if (entree.uuid !== undefined) {
      const existante = this.db
        .query<{ id: number }, [string, string, string, string]>(
          `SELECT id FROM session_entree
            WHERE project_key = ? AND session_id = ? AND subpath = ? AND uuid = ?`,
        )
        .get(projetCle, sessionId, sousChemin, entree.uuid);
      if (existante) {
        this.db
          .query('UPDATE session_entree SET type = ?, donnee = ?, ecrit_a = ? WHERE id = ?')
          .run(entree.type, donnee, ecritA, existante.id);
        return;
      }
    }
    this.db
      .query(
        `INSERT INTO session_entree
           (project_key, session_id, subpath, uuid, type, emetteur, donnee, ecrit_a)
         VALUES (?, ?, ?, ?, ?, NULL, ?, ?)`,
      )
      .run(projetCle, sessionId, sousChemin, entree.uuid ?? null, entree.type, donnee, ecritA);
  }
}
