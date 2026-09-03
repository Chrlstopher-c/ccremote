/**
 * Responsabilité : file de features en attente sur une team occupée (B2,
 * migration 36, axe B). Quand `resoudreTeamPourFeature` trouve une team DÉJÀ
 * `active` sur un (projet, domaine), la feature n'échoue plus — elle ENTRE ICI.
 * À la fin réelle de l'activation en cours, la première `en_attente` du même
 * (projet, domaine) est dépilée et re-dispatchée par le même chemin.
 *
 * `☠` Les transitions d'état sont GARDÉES par un `WHERE etat = …` dans l'UPDATE,
 * jamais par une lecture suivie d'une écriture : deux dépilages concurrents ne
 * doivent pas pouvoir assigner deux fois la même feature. Le nombre de lignes
 * modifiées (`changes`) dit si la transition a réellement eu lieu.
 */

import type { Database } from 'bun:sqlite';
import { executer } from './journal.ts';
import type { CreationFeatureQueue, EtatFeatureQueue, FeatureQueue } from './types.ts';

interface LigneFeatureQueue {
  id: string;
  projet: string;
  domaine: string;
  objectif: string;
  proposition_id: string | null;
  etat: string;
  team_id: string | null;
  cree_a: number;
  prise_en_charge_a: number | null;
}

function versFeature(l: LigneFeatureQueue): FeatureQueue {
  return {
    id: l.id,
    projet: l.projet,
    domaine: l.domaine,
    objectif: l.objectif,
    propositionId: l.proposition_id,
    // as : colonne sous CHECK IN ('en_attente','assignee','en_cours','terminee','annulee').
    etat: l.etat as EtatFeatureQueue,
    teamId: l.team_id,
    creeA: l.cree_a,
    priseEnChargeA: l.prise_en_charge_a,
  };
}

export class DepotFeatureQueue {
  private readonly db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  /** Enfile une feature `en_attente` sur un (projet, domaine). */
  public enfiler(creation: CreationFeatureQueue, maintenant: number = Date.now()): FeatureQueue {
    return executer(
      'featureQueue.enfiler',
      () => {
        this.db
          .query(
            `INSERT INTO feature_queue
               (id, projet, domaine, objectif, proposition_id, etat, team_id, cree_a, prise_en_charge_a)
             VALUES (?, ?, ?, ?, ?, 'en_attente', NULL, ?, NULL)`,
          )
          .run(
            creation.id,
            creation.projet,
            creation.domaine,
            creation.objectif,
            creation.propositionId ?? null,
            maintenant,
          );
        return this.exiger(creation.id);
      },
      { id: creation.id, projet: creation.projet, domaine: creation.domaine },
    );
  }

  public lire(id: string): FeatureQueue | null {
    return executer(
      'featureQueue.lire',
      () => {
        const ligne = this.db.query<LigneFeatureQueue, [string]>('SELECT * FROM feature_queue WHERE id = ?').get(id);
        return ligne ? versFeature(ligne) : null;
      },
      { id },
    );
  }

  private exiger(id: string): FeatureQueue {
    const feature = this.lire(id);
    if (feature === null) throw new Error(`feature « ${id} » introuvable après écriture`);
    return feature;
  }

  /**
   * La PREMIÈRE feature `en_attente` d'un (projet, domaine) — celle à dépiler à la
   * fin de l'activation en cours. `☠` Ordre `cree_a` puis `id` : FIFO stable, et
   * l'`id` départage deux features enfilées à la même milliseconde (l'ordre serait
   * sinon non déterministe, un dépilage pourrait sauter une feature au profit
   * d'une plus récente).
   */
  public premiereEnAttente(projet: string, domaine: string): FeatureQueue | null {
    return executer(
      'featureQueue.premiereEnAttente',
      () => {
        const ligne = this.db
          .query<LigneFeatureQueue, [string, string]>(
            "SELECT * FROM feature_queue WHERE projet = ? AND domaine = ? AND etat = 'en_attente' " +
              'ORDER BY cree_a, id LIMIT 1',
          )
          .get(projet, domaine);
        return ligne ? versFeature(ligne) : null;
      },
      { projet, domaine },
    );
  }

  /** Features `en_attente` d'un (projet, domaine), FIFO — sert au diagnostic/à l'affichage. */
  public listerEnAttente(projet: string, domaine: string): readonly FeatureQueue[] {
    return executer(
      'featureQueue.listerEnAttente',
      () => {
        const lignes = this.db
          .query<LigneFeatureQueue, [string, string]>(
            "SELECT * FROM feature_queue WHERE projet = ? AND domaine = ? AND etat = 'en_attente' " +
              'ORDER BY cree_a, id',
          )
          .all(projet, domaine);
        return lignes.map(versFeature);
      },
      { projet, domaine },
    );
  }

  /**
   * `en_attente` → `assignee` : cette feature est choisie pour dépilage, un
   * dispatch va partir sur `teamId`. `☠` `WHERE etat = 'en_attente'` GARDE la
   * transition : un second dépilage concurrent ne matche rien et rend `false`
   * plutôt que d'assigner deux fois. Le `changes` en est la preuve.
   */
  public assigner(id: string, teamId: string, maintenant: number = Date.now()): boolean {
    return executer(
      'featureQueue.assigner',
      () =>
        this.db
          .query(
            "UPDATE feature_queue SET etat = 'assignee', team_id = ?, prise_en_charge_a = ? " +
              "WHERE id = ? AND etat = 'en_attente'",
          )
          .run(teamId, maintenant, id).changes > 0,
      { id, teamId },
    );
  }

  /**
   * Fait avancer une feature vers un état terminal ou `en_cours`. `☠` Ne matche
   * qu'une feature déjà `assignee` (le dépilage l'a choisie) : marquer terminée
   * une feature `en_attente` sauterait la garde `assigner` et fausserait la file.
   * `remettreEnAttente` sert le rollback d'un dépilage dont le dispatch a échoué.
   */
  public marquer(id: string, etat: Exclude<EtatFeatureQueue, 'en_attente'>): boolean {
    return executer(
      'featureQueue.marquer',
      () =>
        this.db
          .query("UPDATE feature_queue SET etat = ? WHERE id = ? AND etat = 'assignee'")
          .run(etat, id).changes > 0,
      { id, etat },
    );
  }

  /**
   * `assignee` → `en_attente` : rend une feature à la file quand le dispatch qui
   * devait la démarrer a échoué. `☠` Remet `team_id`/`prise_en_charge_a` à NULL —
   * la feature redevient dépilable par n'importe quel réveil ultérieur, comme si
   * elle n'avait jamais été choisie.
   */
  public remettreEnAttente(id: string): boolean {
    return executer(
      'featureQueue.remettreEnAttente',
      () =>
        this.db
          .query(
            "UPDATE feature_queue SET etat = 'en_attente', team_id = NULL, prise_en_charge_a = NULL " +
              "WHERE id = ? AND etat = 'assignee'",
          )
          .run(id).changes > 0,
      { id },
    );
  }
}
