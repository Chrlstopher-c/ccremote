/**
 * Responsabilité : rappels programmés d'une conversation (migration 16).
 *
 * `☠` TOUTE lecture est filtrée par `conversationId`, sans exception — sauf
 * `echus()`, qui sert le balayage et doit voir tout le parc. C'est ce qui rend
 * les rappels réellement individuels : un fil de veille technique ne doit jamais
 * pouvoir réveiller le fil où tourne un chantier de production, ni même savoir
 * qu'il existe.
 *
 * `☠` `prochaineA` est une échéance ABSOLUE, jamais un délai. Un délai relatif
 * repartirait de zéro à chaque redémarrage du Pi — un rappel de dix minutes ne
 * se déclencherait alors jamais sur une machine qu'on déploie plusieurs fois par
 * jour, ce qui est exactement notre cas.
 */

import type { Database } from 'bun:sqlite';
import { executer } from './journal.ts';
import type { EtatRappel, Rappel } from './types.ts';

interface LigneRappel {
  id: string;
  conversation_id: string;
  libelle: string;
  consigne: string;
  prochaine_a: number;
  periode_ms: number | null;
  etat: string;
  declenchements: number;
  max_declenchements: number | null;
  dernier_declenchement_a: number | null;
  derniere_erreur: string | null;
  cree_a: number;
}

function versRappel(l: LigneRappel): Rappel {
  return {
    id: l.id,
    conversationId: l.conversation_id,
    libelle: l.libelle,
    consigne: l.consigne,
    prochaineA: l.prochaine_a,
    periodeMs: l.periode_ms,
    // as : colonne sous CHECK IN ('actif','en_pause','termine').
    etat: l.etat as EtatRappel,
    declenchements: l.declenchements,
    maxDeclenchements: l.max_declenchements,
    dernierDeclenchementA: l.dernier_declenchement_a,
    derniereErreur: l.derniere_erreur,
    creeA: l.cree_a,
  };
}

export interface CreationRappel {
  readonly id: string;
  readonly conversationId: string;
  readonly libelle: string;
  readonly consigne: string;
  readonly prochaineA: number;
  /** `null` ⇒ rappel unique. Renseigné ⇒ récurrent. */
  readonly periodeMs: number | null;
  readonly maxDeclenchements?: number | null;
}

/** Plafond de lecture — un fil n'a aucune raison d'en afficher davantage. */
const LISTE_MAX = 50;

export class DepotRappels {
  constructor(private readonly db: Database) {}

  public creer(creation: CreationRappel, maintenant: number = Date.now()): Rappel {
    return executer(
      'rappels.creer',
      () => {
        this.db
          .query(
            `INSERT INTO rappel
               (id, conversation_id, libelle, consigne, prochaine_a, periode_ms, etat,
                declenchements, max_declenchements, dernier_declenchement_a, derniere_erreur, cree_a)
             VALUES (?, ?, ?, ?, ?, ?, 'actif', 0, ?, NULL, NULL, ?)`,
          )
          .run(
            creation.id,
            creation.conversationId,
            creation.libelle,
            creation.consigne,
            creation.prochaineA,
            creation.periodeMs,
            creation.maxDeclenchements ?? null,
            maintenant,
          );
        const r = this.lire(creation.id);
        if (r === null) throw new Error(`rappel « ${creation.id} » introuvable après écriture`);
        return r;
      },
      { id: creation.id, conversationId: creation.conversationId },
    );
  }

  public lire(id: string): Rappel | null {
    return executer(
      'rappels.lire',
      () => {
        const l = this.db.query<LigneRappel, [string]>('SELECT * FROM rappel WHERE id = ?').get(id);
        return l === null ? null : versRappel(l);
      },
      { id },
    );
  }

  /** Rappels d'UN fil. `☠` Jamais de vue globale ici — voir l'en-tête. */
  public duFil(conversationId: string, inclureInactifs = false): readonly Rappel[] {
    return executer(
      'rappels.duFil',
      () => {
        const sql = inclureInactifs
          ? 'SELECT * FROM rappel WHERE conversation_id = ? ORDER BY prochaine_a LIMIT ?'
          : "SELECT * FROM rappel WHERE conversation_id = ? AND etat != 'termine' ORDER BY prochaine_a LIMIT ?";
        return this.db
          .query<LigneRappel, [string, number]>(sql)
          .all(conversationId, LISTE_MAX)
          .map(versRappel);
      },
      { conversationId },
    );
  }

  public compterActifs(conversationId: string): number {
    return executer(
      'rappels.compterActifs',
      () => {
        const l = this.db
          .query<{ n: number }, [string]>(
            "SELECT COUNT(*) AS n FROM rappel WHERE conversation_id = ? AND etat = 'actif'",
          )
          .get(conversationId);
        return l?.n ?? 0;
      },
      { conversationId },
    );
  }

  /**
   * Rappels dont l'échéance est passée. Seule lecture transverse du dépôt —
   * elle sert le balayage, qui est par nature global.
   */
  public echus(maintenant: number = Date.now(), limite = 20): readonly Rappel[] {
    return executer('rappels.echus', () => {
      return this.db
        .query<LigneRappel, [number, number]>(
          "SELECT * FROM rappel WHERE etat = 'actif' AND prochaine_a <= ? ORDER BY prochaine_a LIMIT ?",
        )
        .all(maintenant, limite)
        .map(versRappel);
    });
  }

  /**
   * Enregistre un déclenchement et calcule la suite.
   *
   * `☠` La prochaine échéance part de MAINTENANT, pas de l'échéance précédente.
   * Un `prochaine_a += periode` accumulerait le retard : après une coupure du Pi
   * d'une heure, un rappel de 10 min aurait six échéances en retard et tirerait
   * six fois d'affilée. On veut « toutes les 10 min », pas « rattrape tout ».
   */
  public marquerDeclenche(id: string, maintenant: number = Date.now()): void {
    executer(
      'rappels.marquerDeclenche',
      () => {
        const r = this.lire(id);
        if (r === null) return;
        const declenchements = r.declenchements + 1;
        const epuise =
          r.periodeMs === null ||
          (r.maxDeclenchements !== null && declenchements >= r.maxDeclenchements);
        this.db
          .query(
            `UPDATE rappel
                SET declenchements = ?, dernier_declenchement_a = ?, derniere_erreur = NULL,
                    etat = ?, prochaine_a = ?
              WHERE id = ?`,
          )
          .run(
            declenchements,
            maintenant,
            epuise ? 'termine' : 'actif',
            epuise ? r.prochaineA : maintenant + (r.periodeMs ?? 0),
            id,
          );
      },
      { id },
    );
  }

  /**
   * Reporte une échéance sans compter de déclenchement.
   *
   * `☠` Sert le cas « carburant critique » : on ne veut ni tirer, ni perdre le
   * rappel, ni le voir revenir à chaque passage du balayage (ce qui produirait
   * une tempête de tentatives). Reporter est la seule option qui ne ment pas.
   */
  public reporter(id: string, prochaineA: number, raison: string): void {
    executer(
      'rappels.reporter',
      () => {
        this.db
          .query('UPDATE rappel SET prochaine_a = ?, derniere_erreur = ? WHERE id = ?')
          .run(prochaineA, raison.slice(0, 300), id);
      },
      { id },
    );
  }

  /**
   * Met en pause. `☠` DISTINCT de la suppression : le rappel garde sa consigne,
   * sa période et son compteur, et pourra reprendre. C'est ce que « pause » veut
   * dire — sans cet état, mettre en veille une veille technique le temps d'un
   * chantier obligerait à la reconstruire de mémoire.
   */
  public mettreEnPause(id: string, conversationId: string): boolean {
    return executer(
      'rappels.mettreEnPause',
      () => {
        // `☠` Le fil est dans le WHERE de TOUTES les écritures : un identifiant
        // deviné ne doit pas permettre de toucher au rappel d'une autre
        // conversation. C'est ce qui rend l'isolation réelle et pas déclarative.
        const res = this.db
          .query("UPDATE rappel SET etat = 'en_pause' WHERE id = ? AND conversation_id = ? AND etat = 'actif'")
          .run(id, conversationId);
        return res.changes > 0;
      },
      { id, conversationId },
    );
  }

  /**
   * Reprend un rappel en pause, en repartant de MAINTENANT.
   *
   * `☠` La prochaine échéance est recalculée, jamais conservée : un rappel repris
   * après trois jours de pause a une échéance largement dépassée et tirerait
   * immédiatement, puis à chaque passage du balayage. Reprendre, c'est
   * redémarrer le cycle, pas rattraper le temps perdu.
   *
   * `☠` Ne ressuscite JAMAIS un `termine` — d'où l'énuméré : un one-shot déjà
   * tiré n'a plus rien à faire, et le reprendre le ferait tirer une seconde fois.
   */
  public reprendre(id: string, conversationId: string, maintenant: number = Date.now()): boolean {
    return executer(
      'rappels.reprendre',
      () => {
        const r = this.lire(id);
        if (r === null || r.conversationId !== conversationId || r.etat !== 'en_pause') return false;
        const res = this.db
          .query("UPDATE rappel SET etat = 'actif', prochaine_a = ?, derniere_erreur = NULL WHERE id = ? AND conversation_id = ?")
          .run(maintenant + (r.periodeMs ?? 60_000), id, conversationId);
        return res.changes > 0;
      },
      { id, conversationId },
    );
  }

  /**
   * Modifie ce qui peut l'être. `☠` Les champs absents ne sont pas touchés :
   * changer la consigne ne doit pas remettre le compteur à zéro ni décaler
   * l'échéance, sinon corriger une faute de frappe relancerait tout le cycle.
   */
  public modifier(
    id: string,
    conversationId: string,
    champs: {
      readonly libelle?: string;
      readonly consigne?: string;
      readonly periodeMs?: number | null;
      readonly prochaineA?: number;
    },
  ): boolean {
    return executer(
      'rappels.modifier',
      () => {
        const r = this.lire(id);
        if (r === null || r.conversationId !== conversationId || r.etat === 'termine') return false;
        const res = this.db
          .query(
            `UPDATE rappel SET libelle = ?, consigne = ?, periode_ms = ?, prochaine_a = ?
              WHERE id = ? AND conversation_id = ?`,
          )
          .run(
            champs.libelle ?? r.libelle,
            champs.consigne ?? r.consigne,
            champs.periodeMs === undefined ? r.periodeMs : champs.periodeMs,
            champs.prochaineA ?? r.prochaineA,
            id,
            conversationId,
          );
        return res.changes > 0;
      },
      { id, conversationId },
    );
  }

  /**
   * Supprime réellement. `☠` Toujours scopé au fil — et sans plus de cérémonie :
   * un rappel est un petit objet reconstructible, propre à une conversation.
   * Rien à voir avec la suppression d'un projet, qui reste hors de portée de
   * l'orchestrateur pour cette raison précise.
   */
  public supprimer(id: string, conversationId: string): boolean {
    return executer(
      'rappels.supprimer',
      () => {
        const res = this.db
          .query('DELETE FROM rappel WHERE id = ? AND conversation_id = ?')
          .run(id, conversationId);
        return res.changes > 0;
      },
      { id, conversationId },
    );
  }

  public supprimerTous(conversationId: string): number {
    return executer(
      'rappels.supprimerTous',
      () => this.db.query('DELETE FROM rappel WHERE conversation_id = ?').run(conversationId).changes,
      { conversationId },
    );
  }
}
