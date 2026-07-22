/**
 * Responsabilité : écriture des deux états d'une mission et de leur historique.
 *
 * ☠ PANNE #30 — E.1.1 : les états SDK (`idle` | `running` | `requires_action`,
 * rapportés par le worker) et les états harness (`en_pause`, `echec_definitif`,
 * `terminee`, …, décidés par le Pi) vivent dans DEUX champs distincts.
 * Deux méthodes distinctes, deux colonnes distinctes, deux horodatages distincts,
 * deux CHECK disjoints en base. Les fusionner rend la réconciliation de E.1.4
 * impossible : on ne saurait plus qui fait autorité sur quoi.
 *
 * Rappel d'autorité (E.1.4) : sur l'état SDK, c'est le PC qui gagne. Sur l'état
 * harness, c'est le Pi. Le registre n'arbitre pas, il conserve les deux.
 */

import type { Database } from 'bun:sqlite';
import { executer } from './journal.ts';
import { versMission, versTransition, type LigneMission, type LigneTransition } from './lignes.ts';
import {
  ETATS_HARNESS_TERMINAUX,
  type EtatHarness,
  type EtatSdk,
  type Mission,
  type OrigineTransition,
  type Transition,
} from './types.ts';

export interface OptionsTransitionHarness {
  readonly motif?: string | null;
  readonly raisonTerminale?: string | null;
  readonly maintenant?: number;
}

export class DepotEtats {
  private readonly db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  /**
   * Applique un état rapporté par le worker. N'écrit JAMAIS dans `etat_harness`.
   * Idempotent : un même état réappliqué ne crée pas de transition en double.
   */
  public appliquerEtatSdk(
    missionId: string,
    etat: EtatSdk,
    maintenant: number = Date.now(),
  ): Mission {
    return executer(
      'etats.appliquerEtatSdk',
      () =>
        this.db.transaction(() => {
          const avant = this.exiger(missionId);
          if (avant.etatSdk === etat) return avant;
          this.db
            .query('UPDATE mission SET etat_sdk = ?, etat_sdk_maj_a = ? WHERE id = ?')
            .run(etat, maintenant, missionId);
          this.journaliser(missionId, 'sdk', avant.etatSdk, etat, null, maintenant);
          return this.exiger(missionId);
        })(),
      { missionId, etat },
    );
  }

  /**
   * Applique une décision du control plane. N'écrit JAMAIS dans `etat_sdk`.
   * Estampille `demarree_a` / `terminee_a` — `terminee` est le cas NOMINAL (F2.0.1).
   */
  public appliquerEtatHarness(
    missionId: string,
    etat: EtatHarness,
    options: OptionsTransitionHarness = {},
  ): Mission {
    const maintenant = options.maintenant ?? Date.now();
    return executer(
      'etats.appliquerEtatHarness',
      () =>
        this.db.transaction(() => {
          const avant = this.exiger(missionId);
          if (avant.etatHarness === etat) return avant;
          this.ecrireEtatHarness(missionId, etat, options, maintenant);
          this.journaliser(missionId, 'harness', avant.etatHarness, etat, options.motif ?? null, maintenant);
          return this.exiger(missionId);
        })(),
      { missionId, etat },
    );
  }

  public historique(missionId: string, limite: number = 200): readonly Transition[] {
    return executer(
      'etats.historique',
      () => {
        const lignes = this.db
          .query<LigneTransition, [string, number]>(
            'SELECT * FROM transition_etat WHERE mission_id = ? ORDER BY survenu_a, id LIMIT ?',
          )
          .all(missionId, limite);
        return lignes.map(versTransition);
      },
      { missionId },
    );
  }

  public historiqueParOrigine(
    missionId: string,
    origine: OrigineTransition,
  ): readonly Transition[] {
    return executer(
      'etats.historiqueParOrigine',
      () => {
        const lignes = this.db
          .query<LigneTransition, [string, string]>(
            'SELECT * FROM transition_etat WHERE mission_id = ? AND origine = ? ORDER BY survenu_a, id',
          )
          .all(missionId, origine);
        return lignes.map(versTransition);
      },
      { missionId, origine },
    );
  }

  private ecrireEtatHarness(
    missionId: string,
    etat: EtatHarness,
    options: OptionsTransitionHarness,
    maintenant: number,
  ): void {
    const terminal = ETATS_HARNESS_TERMINAUX.includes(etat);
    this.db
      .query(
        `UPDATE mission SET
           etat_harness = ?,
           etat_harness_maj_a = ?,
           demarree_a = CASE WHEN ? = 'en_cours' AND demarree_a IS NULL THEN ? ELSE demarree_a END,
           terminee_a = CASE WHEN ? = 1 THEN ? ELSE NULL END,
           derniere_raison_terminale = COALESCE(?, derniere_raison_terminale)
         WHERE id = ?`,
      )
      .run(
        etat,
        maintenant,
        etat,
        maintenant,
        terminal ? 1 : 0,
        maintenant,
        options.raisonTerminale ?? null,
        missionId,
      );
  }

  private journaliser(
    missionId: string,
    origine: OrigineTransition,
    precedent: string | null,
    nouveau: string,
    motif: string | null,
    maintenant: number,
  ): void {
    this.db
      .query(
        `INSERT INTO transition_etat
           (mission_id, origine, etat_precedent, etat_nouveau, motif, survenu_a)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(missionId, origine, precedent, nouveau, motif, maintenant);
  }

  private exiger(missionId: string): Mission {
    const ligne = this.db
      .query<LigneMission, [string]>('SELECT * FROM mission WHERE id = ?')
      .get(missionId);
    if (!ligne) throw new Error(`mission « ${missionId} » introuvable`);
    return versMission(ligne);
  }
}
