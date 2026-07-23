/**
 * Responsabilité : mandats proposés par l'orchestrateur et en attente
 * d'autorisation humaine (H-61, migration 4).
 *
 * `☠` C'est ce dépôt qui rend H-61 réellement applicable. Sans lui, la
 * proposition ne survivait pas au tour qui l'avait produite : l'orchestrateur
 * annonçait « valide dans l'interface » devant un écran qui n'avait jamais rien
 * reçu. Une règle d'autorisation dont la demande n'est pas persistée n'est pas
 * une règle, c'est une impasse.
 */

import type { Database } from 'bun:sqlite';
import { executer } from './journal.ts';
import type { Proposition, StatutProposition } from './types.ts';

interface LigneProposition {
  id: string;
  conversation_id: string | null;
  projet: string;
  objectif: string;
  critere_arret: string | null;
  perimetre: string;
  budget_max_usd: number;
  modele: string | null;
  effort: string | null;
  statut: string;
  mission_id: string | null;
  detail: string | null;
  cree_a: number;
  maj_a: number;
}

function versProposition(l: LigneProposition): Proposition {
  return {
    id: l.id,
    conversationId: l.conversation_id,
    projet: l.projet,
    objectif: l.objectif,
    critereArret: l.critere_arret,
    perimetre: l.perimetre,
    budgetMaxUsd: l.budget_max_usd,
    modele: l.modele,
    effort: l.effort,
    // as : colonne sous CHECK IN ('en_attente','approuvee','refusee').
    statut: l.statut as StatutProposition,
    missionId: l.mission_id,
    detail: l.detail,
    creeA: l.cree_a,
    majA: l.maj_a,
  };
}

export interface CreationProposition {
  readonly id: string;
  readonly conversationId: string | null;
  readonly projet: string;
  readonly objectif: string;
  readonly critereArret: string | null;
  readonly perimetre: string;
  readonly budgetMaxUsd: number;
  readonly modele?: string | null;
  readonly effort?: string | null;
}

export class DepotPropositions {
  private readonly db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  public creer(creation: CreationProposition, maintenant: number = Date.now()): Proposition {
    return executer(
      'propositions.creer',
      () => {
        this.db
          .query(
            `INSERT INTO proposition
               (id, conversation_id, projet, objectif, critere_arret, perimetre,
                budget_max_usd, modele, effort, statut, mission_id, detail, cree_a, maj_a)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'en_attente', NULL, NULL, ?, ?)`,
          )
          .run(
            creation.id,
            creation.conversationId,
            creation.projet,
            creation.objectif,
            creation.critereArret,
            creation.perimetre,
            creation.budgetMaxUsd,
            creation.modele ?? null,
            creation.effort ?? null,
            maintenant,
            maintenant,
          );
        const p = this.lire(creation.id);
        if (!p) throw new Error(`proposition « ${creation.id} » introuvable après écriture`);
        return p;
      },
      { id: creation.id },
    );
  }

  public lire(id: string): Proposition | null {
    return executer(
      'propositions.lire',
      () => {
        const ligne = this.db
          .query<LigneProposition, [string]>('SELECT * FROM proposition WHERE id = ?')
          .get(id);
        return ligne ? versProposition(ligne) : null;
      },
      { id },
    );
  }

  public enAttente(): readonly Proposition[] {
    return executer('propositions.enAttente', () => {
      const lignes = this.db
        .query<LigneProposition, []>("SELECT * FROM proposition WHERE statut = 'en_attente' ORDER BY cree_a DESC")
        .all();
      return lignes.map(versProposition);
    });
  }

  /**
   * Tranche une proposition. `☠` Ne réussit QUE depuis `en_attente` : sans cette
   * garde, un double clic (ou deux onglets ouverts) dispatcherait deux équipes
   * pour un seul mandat autorisé. Le `false` doit remonter jusqu'à l'interface.
   */
  public trancher(
    id: string,
    statut: Exclude<StatutProposition, 'en_attente'>,
    detail: string | null,
    missionId: string | null,
    maintenant: number = Date.now(),
  ): boolean {
    return executer(
      'propositions.trancher',
      () => {
        const res = this.db
          .query(
            `UPDATE proposition
                SET statut = ?, detail = ?, mission_id = ?, maj_a = ?
              WHERE id = ? AND statut = 'en_attente'`,
          )
          .run(statut, detail, missionId, maintenant, id);
        return res.changes > 0;
      },
      { id, statut },
    );
  }
}
