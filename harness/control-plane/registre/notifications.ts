/**
 * Responsabilité : faits du parc destinés à être lus — par Chris dans l'interface,
 * par l'orchestrateur dans son fil (migration 14).
 *
 * `☠` Une notification est un FAIT PERSISTÉ, pas un message en vol. Elle est
 * écrite avant qu'on tente quoi que ce soit avec elle, et sa remise à
 * l'orchestrateur est un champ (`remisA`, `echecRemise`), pas une condition
 * d'existence. Le harness a déjà payé ce prix : le bus d'escalade retiré le
 * 31/07 n'avait aucune trace hors de sa livraison, si bien qu'une demande non
 * livrée n'avait jamais existé — et personne ne pouvait le constater.
 *
 * Corollaire pratique : `nonRemises()` permet de rattraper au réveil ce qui
 * n'avait pas pu être remis pendant la nuit, ce qu'une file en mémoire aurait
 * perdu au premier redémarrage du Pi.
 */

import type { Database } from 'bun:sqlite';
import { executer } from './journal.ts';
import type { Notification, TypeNotification } from './types.ts';

interface LigneNotification {
  id: string;
  type: string;
  mission_id: string | null;
  conversation_id: string | null;
  titre: string;
  corps: string;
  cree_a: number;
  lu_a: number | null;
  remis_a: number | null;
  echec_remise: string | null;
}

function versNotification(l: LigneNotification): Notification {
  return {
    id: l.id,
    // as : la colonne n'a pas de CHECK — le type est une liste ouverte par
    // conception (un type inconnu s'affiche, il ne casse pas la lecture).
    type: l.type as TypeNotification,
    missionId: l.mission_id,
    conversationId: l.conversation_id,
    titre: l.titre,
    corps: l.corps,
    creeA: l.cree_a,
    luA: l.lu_a,
    remisA: l.remis_a,
    echecRemise: l.echec_remise,
  };
}

export interface CreationNotification {
  readonly id: string;
  readonly type: TypeNotification;
  readonly missionId: string | null;
  readonly conversationId: string | null;
  readonly titre: string;
  readonly corps: string;
}

/** Plafond de lecture — l'interface pagine, elle ne réclame jamais tout l'historique. */
const LISTE_DEFAUT = 50;

export class DepotNotifications {
  constructor(private readonly db: Database) {}

  public creer(creation: CreationNotification, maintenant: number = Date.now()): Notification {
    return executer(
      'notifications.creer',
      () => {
        this.db
          .query(
            `INSERT INTO notification
               (id, type, mission_id, conversation_id, titre, corps, cree_a, lu_a, remis_a, echec_remise)
             VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL)`,
          )
          .run(
            creation.id,
            creation.type,
            creation.missionId,
            creation.conversationId,
            creation.titre,
            creation.corps,
            maintenant,
          );
        const n = this.lire(creation.id);
        if (n === null) throw new Error(`notification « ${creation.id} » introuvable après écriture`);
        return n;
      },
      { id: creation.id, type: creation.type },
    );
  }

  public lire(id: string): Notification | null {
    return executer(
      'notifications.lire',
      () => {
        const ligne = this.db
          .query<LigneNotification, [string]>('SELECT * FROM notification WHERE id = ?')
          .get(id);
        return ligne === null ? null : versNotification(ligne);
      },
      { id },
    );
  }

  public recentes(limite: number = LISTE_DEFAUT): readonly Notification[] {
    return executer('notifications.recentes', () => {
      const lignes = this.db
        .query<LigneNotification, [number]>('SELECT * FROM notification ORDER BY cree_a DESC LIMIT ?')
        .all(limite);
      return lignes.map(versNotification);
    });
  }

  /**
   * Notifications créées APRÈS `curseur`, triées par ancienneté croissante —
   * ça garantit de ne rien sauter tant que le client rappelle avec le `creeA`
   * du DERNIER élément reçu comme nouveau curseur.
   *
   * `☠` Le curseur porte sur `cree_a`, JAMAIS sur `id` : les identifiants sont
   * des UUID (migration 4), sans ordre naturel — un curseur sur `id` sauterait
   * ou redoublerait des lignes au hasard, plafond ou pas. C'est `nonRemises()`
   * qui a déjà posé ce même choix, pour la même raison.
   *
   * `☠` Trié ASCENDANT, contrairement à `recentes()` (DESC, plafond
   * d'affichage) : un tri DESC sous LIMIT laisserait un trou permanent entre
   * le curseur et la coupure dès que plus de `limite` faits se sont produits
   * depuis — exactement le rattrapage que cette méthode existe pour garantir.
   */
  public posterieures(curseur: number, limite: number = LISTE_DEFAUT): readonly Notification[] {
    return executer(
      'notifications.posterieures',
      () => {
        const lignes = this.db
          .query<LigneNotification, [number, number]>(
            'SELECT * FROM notification WHERE cree_a > ? ORDER BY cree_a ASC LIMIT ?',
          )
          .all(curseur, limite);
        return lignes.map(versNotification);
      },
      { curseur },
    );
  }

  public nombreNonLues(): number {
    return executer('notifications.nombreNonLues', () => {
      const ligne = this.db
        .query<{ n: number }, []>('SELECT COUNT(*) AS n FROM notification WHERE lu_a IS NULL')
        .get();
      return ligne?.n ?? 0;
    });
  }

  /**
   * `☠` Ce que l'orchestrateur n'a pas encore reçu, borné à une conversation.
   * Sert le rattrapage : une notification produite alors que sa session dormait
   * lui est remise à son réveil, au lieu d'être perdue faute d'auditeur.
   */
  public nonRemises(conversationId: string, limite: number = LISTE_DEFAUT): readonly Notification[] {
    return executer(
      'notifications.nonRemises',
      () => {
        const lignes = this.db
          .query<LigneNotification, [string, number]>(
            `SELECT * FROM notification
             WHERE conversation_id = ? AND remis_a IS NULL
             ORDER BY cree_a ASC LIMIT ?`,
          )
          .all(conversationId, limite);
        return lignes.map(versNotification);
      },
      { conversationId },
    );
  }

  public marquerLue(id: string, maintenant: number = Date.now()): boolean {
    return executer(
      'notifications.marquerLue',
      () => {
        const r = this.db
          .query('UPDATE notification SET lu_a = ? WHERE id = ? AND lu_a IS NULL')
          .run(maintenant, id);
        return r.changes > 0;
      },
      { id },
    );
  }

  public toutMarquerLu(maintenant: number = Date.now()): number {
    return executer('notifications.toutMarquerLu', () => {
      const r = this.db.query('UPDATE notification SET lu_a = ? WHERE lu_a IS NULL').run(maintenant);
      return r.changes;
    });
  }

  /** Remise réussie à l'orchestrateur : le fait est entré dans son contexte. */
  public marquerRemise(id: string, maintenant: number = Date.now()): void {
    executer(
      'notifications.marquerRemise',
      () => {
        this.db
          .query('UPDATE notification SET remis_a = ?, echec_remise = NULL WHERE id = ?')
          .run(maintenant, id);
      },
      { id },
    );
  }

  /**
   * Remise impossible. `☠` `remis_a` reste NULL — la notification repassera au
   * prochain réveil. Consigner l'échec sans le rendre réessayable en ferait une
   * perte silencieuse, exactement ce que ce dépôt existe pour empêcher.
   */
  public marquerEchecRemise(id: string, raison: string): void {
    executer(
      'notifications.marquerEchecRemise',
      () => {
        this.db.query('UPDATE notification SET echec_remise = ? WHERE id = ?').run(raison.slice(0, 500), id);
      },
      { id },
    );
  }
}
