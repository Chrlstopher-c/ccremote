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
  session_id: string | null;
  statut: string;
  cree_a: number;
  maj_a: number;
  compactions: number;
  resume_contexte: string | null;
}

interface LigneEvenement {
  seq: number;
  conversation_id: string;
  type: string;
  contenu: string;
  cree_a: number;
}

function versConversation(l: LigneConversation): Conversation {
  return {
    id: l.id,
    titre: l.titre,
    sessionId: l.session_id,
    // as : colonne sous CHECK IN ('active','archivee').
    statut: l.statut as Conversation['statut'],
    creeA: l.cree_a,
    majA: l.maj_a,
    compactions: l.compactions,
    resumeContexte: l.resume_contexte,
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

  public renommer(id: string, titre: string, maintenant: number = Date.now()): boolean {
    return executer(
      'conversations.renommer',
      () => {
        const res = this.db
          .query('UPDATE conversation SET titre = ?, maj_a = ? WHERE id = ?')
          .run(titre, maintenant, id);
        return res.changes > 0;
      },
      { id },
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
   * Ajoute un événement ET touche `maj_a` dans la même transaction. Retourne le
   * `seq` attribué — le curseur que l'UI utilisera pour ne pas relire ce bloc.
   */
  public ajouterEvenement(ajout: AjoutEvenement, maintenant: number = Date.now()): EvenementConversation {
    return executer(
      'conversations.ajouterEvenement',
      () =>
        this.db.transaction(() => {
          const res = this.db
            .query('INSERT INTO conversation_evenement (conversation_id, type, contenu, cree_a) VALUES (?, ?, ?, ?)')
            .run(ajout.conversationId, ajout.type, ajout.contenu, maintenant);
          this.db.query('UPDATE conversation SET maj_a = ? WHERE id = ?').run(maintenant, ajout.conversationId);
          return {
            seq: Number(res.lastInsertRowid),
            conversationId: ajout.conversationId,
            type: ajout.type,
            contenu: ajout.contenu,
            creeA: maintenant,
          };
        })(),
      { conversationId: ajout.conversationId, type: ajout.type },
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
