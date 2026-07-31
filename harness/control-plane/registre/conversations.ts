/**
 * Responsabilité : fils de discussion de l'orchestrateur (migration 2) et leur
 * journal d'événements. La persistance vit ICI : un rechargement dur de l'app
 * ne perd rien, l'UI relit le fil depuis `seq`.
 *
 * `☠` Écrire un événement bouge `conversation.maj_a` dans la MÊME transaction :
 * la liste triée par activité ne peut pas mentir sur « quelle conversation a
 * bougé en dernier ».
 */

import type { Database } from 'bun:sqlite';
import { executer } from './journal.ts';
import type { Conversation, EvenementConversation, TypeEvenementConversation } from './types.ts';

interface LigneConversation {
  id: string;
  titre: string;
  titre_source: string;
  session_id: string | null;
  statut: string;
  cree_a: number;
  maj_a: number;
  compactions: number;
  resume_contexte: string | null;
  modele: string | null;
  effort: string | null;
  autonomie_debut: number | null;
  autonomie_fin: number | null;
  autonomie_objectif: string | null;
}

interface LigneEvenement {
  seq: number;
  conversation_id: string;
  type: string;
  contenu: string;
  cree_a: number;
  modele: string | null;
  effort: string | null;
}

function versConversation(l: LigneConversation): Conversation {
  return {
    id: l.id,
    titre: l.titre,
    // as : colonne alimentée uniquement par `renommer`, dont le paramètre est typé.
    titreSource: l.titre_source as Conversation['titreSource'],
    sessionId: l.session_id,
    // as : colonne sous CHECK IN ('active','archivee').
    statut: l.statut as Conversation['statut'],
    creeA: l.cree_a,
    majA: l.maj_a,
    compactions: l.compactions,
    resumeContexte: l.resume_contexte,
    modele: l.modele,
    effort: l.effort,
    autonomieDebut: l.autonomie_debut,
    autonomieFin: l.autonomie_fin,
    autonomieObjectif: l.autonomie_objectif,
  };
}

function versEvenement(l: LigneEvenement): EvenementConversation {
  return {
    seq: l.seq,
    conversationId: l.conversation_id,
    // as : colonne sous CHECK IN (…) — aucune autre valeur ne peut exister.
    type: l.type as TypeEvenementConversation,
    contenu: l.contenu,
    creeA: l.cree_a,
    modele: l.modele,
    effort: l.effort,
  };
}

export interface CreationConversation {
  readonly id: string;
  readonly titre: string;
}

export interface AjoutEvenement {
  readonly conversationId: string;
  readonly type: TypeEvenementConversation;
  readonly contenu: string;
  /** Ce qui a produit CET évènement — jamais réécrit si le fil change de modèle ensuite. */
  readonly modele?: string | null;
  readonly effort?: string | null;
}

export class DepotConversations {
  private readonly db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  public creer(creation: CreationConversation, maintenant: number = Date.now()): Conversation {
    return executer(
      'conversations.creer',
      () => {
        this.db
          .query('INSERT INTO conversation (id, titre, session_id, statut, cree_a, maj_a) VALUES (?, ?, NULL, ?, ?, ?)')
          .run(creation.id, creation.titre, 'active', maintenant, maintenant);
        const conv = this.lire(creation.id);
        if (!conv) throw new Error(`conversation « ${creation.id} » introuvable après écriture`);
        return conv;
      },
      { id: creation.id },
    );
  }

  public lire(id: string): Conversation | null {
    return executer(
      'conversations.lire',
      () => {
        const ligne = this.db
          .query<LigneConversation, [string]>('SELECT * FROM conversation WHERE id = ?')
          .get(id);
        return ligne ? versConversation(ligne) : null;
      },
      { id },
    );
  }

  /** Fils actifs, le plus récemment actif en tête. */
  public lister(): readonly Conversation[] {
    return executer('conversations.lister', () => {
      const lignes = this.db
        .query<LigneConversation, []>("SELECT * FROM conversation WHERE statut = 'active' ORDER BY maj_a DESC")
        .all();
      return lignes.map(versConversation);
    });
  }

  /**
   * `☠` La source est écrite dans le MÊME `UPDATE` que le titre. Deux écritures
   * séparées laisseraient une fenêtre où un fil porte un titre choisi sans que
   * rien n'enregistre qui l'a choisi — et c'est exactement cette information qui
   * autorise ou refuse le nommage suivant.
   */
  public renommer(
    id: string,
    titre: string,
    source: Conversation['titreSource'] = 'manuel',
    maintenant: number = Date.now(),
  ): boolean {
    return executer(
      'conversations.renommer',
      () => {
        const res = this.db
          .query('UPDATE conversation SET titre = ?, titre_source = ?, maj_a = ? WHERE id = ?')
          .run(titre, source, maintenant, id);
        return res.changes > 0;
      },
      { id, source },
    );
  }

  /** Archivage réversible — l'historique reste, la conversation quitte la liste. */
  public archiver(id: string, maintenant: number = Date.now()): boolean {
    return executer(
      'conversations.archiver',
      () => {
        const res = this.db
          .query("UPDATE conversation SET statut = 'archivee', maj_a = ? WHERE id = ?")
          .run(maintenant, id);
        return res.changes > 0;
      },
      { id },
    );
  }

  /**
   * Enregistre une compaction : incrémente le compte, retient le résumé à
   * réinjecter, et OUBLIE le `session_id` — la prochaine session doit repartir
   * à froid, sinon reprendre l'ancienne rechargerait le contexte qu'on vient
   * précisément de jeter, et la compaction n'aurait servi à rien.
   */
  public enregistrerCompaction(id: string, resume: string, maintenant: number = Date.now()): boolean {
    return executer(
      'conversations.enregistrerCompaction',
      () =>
        this.db.transaction(() => {
          const res = this.db
            .query(
              `UPDATE conversation
                  SET compactions = compactions + 1,
                      resume_contexte = ?,
                      session_id = NULL,
                      maj_a = ?
                WHERE id = ?`,
            )
            .run(resume, maintenant, id);
          if (res.changes === 0) return false;
          this.db
            .query('INSERT INTO conversation_evenement (conversation_id, type, contenu, cree_a) VALUES (?, ?, ?, ?)')
            .run(id, 'compaction', resume, maintenant);
          return true;
        })(),
      { id },
    );
  }

  /** Fixe l'identité SDK réelle une fois la session démarrée (idempotent). */
  /**
   * Pose ou retire la fenêtre d'autonomie du fil (migration 15).
   *
   * `☠` Les trois champs bougent ENSEMBLE, jamais séparément : une fenêtre à
   * moitié posée (début sans fin) serait ouverte pour toujours — exactement le
   * mode de panne qu'une échéance est censée fermer. Passer `null` referme.
   */
  public poserFenetreAutonomie(
    id: string,
    debut: number | null,
    fin: number | null,
    objectif: string | null,
  ): void {
    executer(
      'conversations.poserFenetreAutonomie',
      () => {
        const complet = debut !== null && fin !== null;
        this.db
          .query('UPDATE conversation SET autonomie_debut = ?, autonomie_fin = ?, autonomie_objectif = ? WHERE id = ?')
          .run(complet ? debut : null, complet ? fin : null, complet ? objectif : null, id);
      },
      { id, debut, fin },
    );
  }

  public majSessionId(id: string, sessionId: string, maintenant: number = Date.now()): void {
    executer(
      'conversations.majSessionId',
      () => {
        this.db
          .query('UPDATE conversation SET session_id = ?, maj_a = ? WHERE id = ?')
          .run(sessionId, maintenant, id);
      },
      { id, sessionId },
    );
  }

  /**
   * Pose un contexte de reprise ET oublie l'identité SDK, sans compter de
   * compaction. `☠` Utilisé à la rotation de compte : la session suivante repart
   * à froid sur un autre compte, mais elle ne doit pas repartir AMNÉSIQUE — sans
   * ce report, l'orchestrateur perdait tout le fil et redemandait à l'opérateur
   * ce qu'il venait de lui dire (vécu le 23/07).
   */
  public poserResumeContexte(id: string, resume: string, maintenant: number = Date.now()): void {
    executer(
      'conversations.poserResumeContexte',
      () => {
        this.db
          .query('UPDATE conversation SET resume_contexte = ?, session_id = NULL, maj_a = ? WHERE id = ?')
          .run(resume, maintenant, id);
      },
      { id },
    );
  }

  /**
   * Oublie l'identité SDK : la prochaine session repartira à froid. `☠`
   * Indispensable après une rotation de compte — une session appartient au
   * compte qui l'a créée, et la reprendre ailleurs échoue sur
   * « No conversation found with session ID » (vécu le 23/07).
   */
  public oublierSession(id: string, maintenant: number = Date.now()): void {
    executer(
      'conversations.oublierSession',
      () => {
        this.db.query('UPDATE conversation SET session_id = NULL, maj_a = ? WHERE id = ?').run(maintenant, id);
      },
      { id },
    );
  }

  /**
   * Ajoute un événement ET touche `maj_a` dans la même transaction. Retourne le
   * `seq` attribué — le curseur que l'UI utilisera pour ne pas relire ce bloc.
   */
  public ajouterEvenement(ajout: AjoutEvenement, maintenant: number = Date.now()): EvenementConversation {
    return executer(
      'conversations.ajouterEvenement',
      () =>
        this.db.transaction(() => {
          const res = this.db
            .query(
              `INSERT INTO conversation_evenement (conversation_id, type, contenu, cree_a, modele, effort)
               VALUES (?, ?, ?, ?, ?, ?)`,
            )
            .run(
              ajout.conversationId,
              ajout.type,
              ajout.contenu,
              maintenant,
              ajout.modele ?? null,
              ajout.effort ?? null,
            );
          this.db.query('UPDATE conversation SET maj_a = ? WHERE id = ?').run(maintenant, ajout.conversationId);
          return {
            seq: Number(res.lastInsertRowid),
            conversationId: ajout.conversationId,
            type: ajout.type,
            contenu: ajout.contenu,
            creeA: maintenant,
            modele: ajout.modele ?? null,
            effort: ajout.effort ?? null,
          };
        })(),
      { conversationId: ajout.conversationId, type: ajout.type },
    );
  }

  /**
   * Mémorise le dernier couple modèle/effort du fil. `☠` C'est ce qui permet de
   * rouvrir la conversation là où on l'a laissée, au lieu de retomber sur les
   * défauts en contradiction avec le dernier message affiché.
   */
  public poserModeleEffort(id: string, modele: string | null, effort: string | null, maintenant: number = Date.now()): void {
    executer(
      'conversations.poserModeleEffort',
      () => {
        this.db
          .query('UPDATE conversation SET modele = ?, effort = ?, maj_a = ? WHERE id = ?')
          .run(modele, effort, maintenant, id);
      },
      { id, modele, effort },
    );
  }

  /** Tous les événements d'un fil, ordre chronologique. */
  public evenements(conversationId: string): readonly EvenementConversation[] {
    return this.evenementsDepuis(conversationId, 0);
  }

  /** Événements de `seq` strictement supérieur à `depuis` — le pas de streaming. */
  public evenementsDepuis(conversationId: string, depuis: number): readonly EvenementConversation[] {
    return executer(
      'conversations.evenementsDepuis',
      () => {
        const lignes = this.db
          .query<LigneEvenement, [string, number]>(
            'SELECT * FROM conversation_evenement WHERE conversation_id = ? AND seq > ? ORDER BY seq',
          )
          .all(conversationId, depuis);
        return lignes.map(versEvenement);
      },
      { conversationId, depuis },
    );
  }
}
