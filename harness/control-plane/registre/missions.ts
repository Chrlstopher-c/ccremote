/**
 * Responsabilité : accès aux missions (E.1.3).
 * Une mission est instanciée, jetable, à but borné (F2.0.1) — le registre suit
 * des missions et leur historique, pas un état courant d'équipes durables.
 *
 * Les transitions d'état vivent dans `etats.ts` : ce sont les deux champs que la
 * panne #30 interdit de fusionner, ils méritent leur propre surface.
 */

import type { Database } from 'bun:sqlite';
import { executer } from './journal.ts';
import { versMission, type LigneMission } from './lignes.ts';
import {
  ETATS_HARNESS_ACTIFS,
  type CreationMission,
  type EtatHarness,
  type Mission,
  type PosteContexteMission,
} from './types.ts';

const PLACEHOLDERS_ACTIFS = ETATS_HARNESS_ACTIFS.map(() => '?').join(', ');

export interface CompteurEtat {
  readonly etatHarness: EtatHarness;
  readonly nombre: number;
}

export class DepotMissions {
  private readonly db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  /**
   * Crée une mission à l'état harness `planifiee`, sans état SDK (le worker
   * n'existe pas encore). L'index unique partiel refuse une seconde mission
   * active sur le même projet (H-56).
   */
  public creer(creation: CreationMission, maintenant: number = Date.now()): Mission {
    return executer(
      'missions.creer',
      () => {
        this.db
          .query(
            `INSERT INTO mission (
               id, lot_id, nom, projet, worktree, branche, session_id, compte_id,
               mandat, critere_arret, modele_demande, modele_resolu,
               etat_sdk, etat_sdk_maj_a, etat_harness, etat_harness_maj_a,
               budget_max_usd, cree_a
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, 'planifiee', ?, ?, ?)`,
          )
          .run(
            creation.id,
            creation.lotId,
            creation.nom,
            creation.projet,
            creation.worktree ?? null,
            creation.branche ?? null,
            creation.sessionId ?? null,
            creation.compteId,
            creation.mandat ?? null,
            creation.critereArret ?? null,
            creation.modeleDemande ?? null,
            creation.modeleResolu ?? null,
            maintenant,
            creation.budgetMaxUsd ?? null,
            maintenant,
          );
        return this.exiger(creation.id);
      },
      { id: creation.id, projet: creation.projet },
    );
  }

  public lire(id: string): Mission | null {
    return executer(
      'missions.lire',
      () => {
        const ligne = this.db
          .query<LigneMission, [string]>('SELECT * FROM mission WHERE id = ?')
          .get(id);
        return ligne ? versMission(ligne) : null;
      },
      { id },
    );
  }

  public exiger(id: string): Mission {
    const mission = this.lire(id);
    if (!mission) throw new Error(`mission « ${id} » introuvable`);
    return mission;
  }

  public lireParSession(sessionId: string): Mission | null {
    return executer(
      'missions.lireParSession',
      () => {
        const ligne = this.db
          .query<LigneMission, [string]>('SELECT * FROM mission WHERE session_id = ?')
          .get(sessionId);
        return ligne ? versMission(ligne) : null;
      },
      { sessionId },
    );
  }

  /** Parc actif. Requête bornée au nombre de missions actives, pas au volume historique. */
  public listerActives(): readonly Mission[] {
    return executer('missions.listerActives', () => {
      const lignes = this.db
        .query<LigneMission, string[]>(
          `SELECT * FROM mission
            WHERE etat_harness IN (${PLACEHOLDERS_ACTIFS})
            ORDER BY etat_harness_maj_a DESC`,
        )
        .all(...ETATS_HARNESS_ACTIFS);
      return lignes.map(versMission);
    });
  }

  /**
   * Parc complet, tous états — la vue « parc » de l'interface (contrat API,
   * `GET /api/harness/missions`).
   *
   * `☠` Bornée explicitement, contrairement à `listerActives()` : ce SELECT
   * porte sur l'historique entier, qui ne cesse de croître. Sans limite, la
   * page du parc ralentirait proportionnellement à l'âge du déploiement — le
   * genre de dégradation qu'on ne voit jamais en développement et toujours en
   * production. Les plus récemment actives d'abord, ce sont celles qu'on
   * regarde.
   */
  public listerRecentes(limite = 200): readonly Mission[] {
    return executer(
      'missions.listerRecentes',
      () => {
        const lignes = this.db
          .query<LigneMission, [number]>(
            'SELECT * FROM mission ORDER BY etat_harness_maj_a DESC LIMIT ?',
          )
          .all(limite);
        return lignes.map(versMission);
      },
      { limite },
    );
  }

  public listerParLot(lotId: string): readonly Mission[] {
    return executer(
      'missions.listerParLot',
      () => {
        const lignes = this.db
          .query<LigneMission, [string]>(
            'SELECT * FROM mission WHERE lot_id = ? ORDER BY cree_a',
          )
          .all(lotId);
        return lignes.map(versMission);
      },
      { lotId },
    );
  }

  /** Mission active d'un projet, s'il y en a une. Au plus une en v1 (H-56). */
  public lireActiveDuProjet(projet: string): Mission | null {
    return executer(
      'missions.lireActiveDuProjet',
      () => {
        const ligne = this.db
          .query<LigneMission, string[]>(
            `SELECT * FROM mission
              WHERE projet = ? AND etat_harness IN (${PLACEHOLDERS_ACTIFS})`,
          )
          .get(projet, ...ETATS_HARNESS_ACTIFS);
        return ligne ? versMission(ligne) : null;
      },
      { projet },
    );
  }

  public attacherSession(id: string, sessionId: string): Mission {
    return this.majChamp('missions.attacherSession', id, 'session_id', sessionId);
  }

  public definirModeleResolu(id: string, modele: string): Mission {
    return this.majChamp('missions.definirModeleResolu', id, 'modele_resolu', modele);
  }

  public definirWorktree(id: string, worktree: string, branche: string | null): Mission {
    return executer(
      'missions.definirWorktree',
      () => {
        this.db
          .query('UPDATE mission SET worktree = ?, branche = ? WHERE id = ?')
          .run(worktree, branche, id);
        return this.exiger(id);
      },
      { id },
    );
  }

  /** Incrémente l'epoch de fencing (D.2.3) et retourne la nouvelle valeur. */
  public incrementerEpoch(id: string): number {
    return executer(
      'missions.incrementerEpoch',
      () => {
        this.db.query('UPDATE mission SET epoch = epoch + 1 WHERE id = ?').run(id);
        return this.exiger(id).epoch;
      },
      { id },
    );
  }

  /**
   * Avance le high-water mark d'observation (D.2.2). Strictement monotone :
   * reculer rejouerait de l'historique déjà consommé. Retourne la valeur retenue.
   */
  public avancerHighWaterMark(id: string, valeur: number): number {
    return executer(
      'missions.avancerHighWaterMark',
      () => {
        this.db
          .query('UPDATE mission SET high_water_mark = ? WHERE id = ? AND ? > high_water_mark')
          .run(valeur, id, valeur);
        return this.exiger(id).highWaterMark;
      },
      { id, valeur },
    );
  }

  public ajouterCout(id: string, coutUsd: number): Mission {
    return executer(
      'missions.ajouterCout',
      () => {
        this.db
          .query('UPDATE mission SET budget_consomme_usd = budget_consomme_usd + ? WHERE id = ?')
          .run(coutUsd, id);
        return this.exiger(id);
      },
      { id },
    );
  }

  public definirUsageContexte(
    id: string,
    utilises: number,
    max: number | null,
    ventilation: readonly PosteContexteMission[] | null = null,
  ): Mission {
    return executer(
      'missions.definirUsageContexte',
      () => {
        // `☠` `COALESCE` sur la ventilation : un relevé qui n'en porte pas ne
        // doit pas EFFACER la dernière connue. Le SDK ne la rend que pendant que
        // la session vit — l'écraser à null au premier relevé sans détail
        // reviendrait à ne jamais rien afficher sur une mission terminée.
        this.db
          .query(
            `UPDATE mission
                SET contexte_tokens_utilises = ?,
                    contexte_tokens_max = ?,
                    contexte_ventilation = COALESCE(?, contexte_ventilation)
              WHERE id = ?`,
          )
          .run(utilises, max, ventilation === null ? null : JSON.stringify(ventilation), id);
        return this.exiger(id);
      },
      { id },
    );
  }

  /**
   * Enregistre un texte produit par l'équipe. `☠` C'est ce que l'opérateur veut
   * lire : sans ça, le fil ne montre que des changements d'état, et un rapport
   * final n'apparaît nulle part (23/07).
   */
  public ajouterActivite(missionId: string, texte: string, survenuA: number = Date.now()): void {
    executer(
      'missions.ajouterActivite',
      () => {
        this.db
          .query('INSERT INTO activite_mission (mission_id, texte, survenu_a) VALUES (?, ?, ?)')
          .run(missionId, texte, survenuA);
      },
      { missionId },
    );
  }

  /** Textes produits par l'équipe, du plus ancien au plus récent, bornés. */
  public activites(missionId: string, limite = 200): readonly { texte: string; survenuA: number }[] {
    return executer(
      'missions.activites',
      () => {
        const lignes = this.db
          .query<{ texte: string; survenu_a: number }, [string, number]>(
            'SELECT texte, survenu_a FROM activite_mission WHERE mission_id = ? ORDER BY survenu_a, id LIMIT ?',
          )
          .all(missionId, limite);
        return lignes.map((l) => ({ texte: l.texte, survenuA: l.survenu_a }));
      },
      { missionId },
    );
  }

  public incrementerRelances(id: string): number {
    return executer(
      'missions.incrementerRelances',
      () => {
        this.db
          .query('UPDATE mission SET compteur_relances = compteur_relances + 1 WHERE id = ?')
          .run(id);
        return this.exiger(id).compteurRelances;
      },
      { id },
    );
  }

  public compterParEtatHarness(): readonly CompteurEtat[] {
    return executer('missions.compterParEtatHarness', () => {
      const lignes = this.db
        .query<{ etat_harness: EtatHarness; nombre: number }, []>(
          'SELECT etat_harness, COUNT(*) AS nombre FROM mission GROUP BY etat_harness',
        )
        .all();
      return lignes.map((l) => ({ etatHarness: l.etat_harness, nombre: l.nombre }));
    });
  }

  /**
   * Purge les missions terminées avant `avant` (epoch ms). Primitive de rétention :
   * la POLITIQUE de rétention appartient à M-63, pas au registre.
   * Les transitions et capacités partent en cascade.
   */
  public purgerTermineesAvant(avant: number): number {
    return executer(
      'missions.purgerTermineesAvant',
      () =>
        this.db.transaction(() => {
          // ☠ `changes` compte AUSSI les lignes supprimées en cascade (transitions,
          // capacités). Le nombre de missions purgées se compte donc explicitement,
          // sinon la valeur retournée enfle avec l'historique de chaque mission.
          const condamnees = this.db
            .query<{ id: string }, [number]>(
              'SELECT id FROM mission WHERE terminee_a IS NOT NULL AND terminee_a < ?',
            )
            .all(avant);
          this.db
            .query('DELETE FROM mission WHERE terminee_a IS NOT NULL AND terminee_a < ?')
            .run(avant);
          return condamnees.length;
        })(),
      { avant },
    );
  }

  private majChamp(operation: string, id: string, colonne: string, valeur: string): Mission {
    return executer(
      operation,
      () => {
        this.db.query(`UPDATE mission SET ${colonne} = ? WHERE id = ?`).run(valeur, id);
        return this.exiger(id);
      },
      { id, colonne },
    );
  }
}
