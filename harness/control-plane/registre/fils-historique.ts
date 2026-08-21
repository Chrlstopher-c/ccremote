/**
 * Responsabilité : lecture SEULE de l'historique des fils (conversations) et de
 * leurs événements, pour l'outillage de relecture de l'orchestrateur
 * (`mcp-controle/outils-historique-fils.ts`). Aucune écriture ici — ce dépôt
 * n'expose que des `SELECT`, jamais un `INSERT`/`UPDATE`/`DELETE`.
 *
 * `☠` Dépôt séparé de `DepotConversations`, à dessein : `conversations.ts`
 * frôle déjà sa limite de 500 lignes (même motif que l'extraction de
 * `lignes-conversation.ts`, documentée dans son en-tête). Ce dépôt réutilise le
 * mappeur `versEvenement` existant plutôt que d'en dupliquer un second.
 *
 * `☠` Aucun index n'est ajouté pour ces requêtes (consigne explicite : lecture
 * seule, ne rien changer au schéma). `lister` fait un balayage de
 * `conversation_evenement` sans filtre d'index dédié — acceptable au volume
 * actuel du registre (un parc personnel, pas un historique de production à
 * grande échelle) ; si ce volume grossit au point de le rendre lent, l'index à
 * poser serait `idx_conv_evt_cree_a ON conversation_evenement(conversation_id, cree_a)`.
 */

import type { Database } from 'bun:sqlite';
import { executer } from './journal.ts';
import { versEvenement, type LigneEvenement } from './lignes-conversation.ts';
import type { EvenementConversation } from './types.ts';

/** Résumé d'un fil pour `lister_fils` — jamais son contenu. */
export interface ResumeFil {
  readonly id: string;
  readonly titre: string;
  /** Horodatage du PREMIER événement du fil ENTIER, jamais borné par le filtre de plage. */
  readonly premierEvenementA: number;
  /** Horodatage du DERNIER événement du fil ENTIER, jamais borné par le filtre de plage. */
  readonly dernierEvenementA: number;
  /** Nombre total d'événements du fil ENTIER. */
  readonly nombreMessages: number;
}

export interface OptionsListeFils {
  readonly depuis: number;
  readonly jusqua: number;
  readonly limite: number;
}

export interface OptionsLectureFil {
  readonly depuis: number;
  readonly jusqua: number;
  /** `null` = pas de recherche textuelle. */
  readonly recherche: string | null;
  readonly decalage: number;
  readonly limite: number;
}

export interface PageEvenementsFil {
  readonly evenements: readonly EvenementConversation[];
  /** Compte TOTAL de messages correspondant au filtre, au-delà de la page rendue. */
  readonly total: number;
}

interface LigneResumeFil {
  id: string;
  titre: string;
  premier: number;
  dernier: number;
  nb: number;
}

/**
 * Échappe les caractères spéciaux de `LIKE` (`%`, `_`, l'échappeur lui-même) —
 * sans ça, chercher littéralement « 50% » ou « var_x » se comporterait comme un
 * joker et rendrait des correspondances que personne n'a demandées.
 */
function echapperMotifLike(motif: string): string {
  return motif.replace(/[\\%_]/g, (car) => `\\${car}`);
}

export class DepotFilsHistorique {
  private readonly db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  /**
   * Fils ayant au moins un événement dans `[depuis, jusqua]`, triés par
   * dernière activité décroissante. `☠` Les dates et le compte RENDUS portent
   * sur le fil ENTIER, jamais sur la seule tranche filtrée : le filtre ne sert
   * qu'à choisir QUELS fils apparaissent, pas à tronquer ce qu'on dit d'eux.
   */
  public lister(options: OptionsListeFils): readonly ResumeFil[] {
    return executer(
      'filsHistorique.lister',
      () => {
        const lignes = this.db
          .query<LigneResumeFil, [number, number, number]>(
            `SELECT c.id AS id, c.titre AS titre,
                    MIN(e.cree_a) AS premier, MAX(e.cree_a) AS dernier, COUNT(*) AS nb
               FROM conversation c
               JOIN conversation_evenement e ON e.conversation_id = c.id
              WHERE c.id IN (
                      SELECT DISTINCT conversation_id FROM conversation_evenement
                       WHERE cree_a >= ? AND cree_a <= ?
                    )
              GROUP BY c.id
              ORDER BY dernier DESC
              LIMIT ?`,
          )
          .all(options.depuis, options.jusqua, options.limite);
        return lignes.map((l) => ({
          id: l.id,
          titre: l.titre,
          premierEvenementA: l.premier,
          dernierEvenementA: l.dernier,
          nombreMessages: l.nb,
        }));
      },
      { ...options },
    );
  }

  /**
   * Une page d'événements d'UN fil, ordre chronologique, filtrée par plage de
   * dates et recherche textuelle optionnelle. `total` porte le compte SANS la
   * pagination — c'est ce qui permet à l'appelant de dire « il en reste ».
   *
   * `☠` `recherche` est bindé DEUX FOIS au même motif échappé (une fois pour
   * `total`, une fois pour la page) plutôt que construit par concaténation de
   * SQL : c'est ce qui garde la requête paramétrée, jamais une entrée utilisateur
   * interpolée dans le texte de la requête.
   */
  public evenements(conversationId: string, options: OptionsLectureFil): PageEvenementsFil {
    return executer(
      'filsHistorique.evenements',
      () => {
        const motif = options.recherche === null ? null : `%${echapperMotifLike(options.recherche)}%`;
        const clauseBase = 'conversation_id = ? AND cree_a >= ? AND cree_a <= ? AND (? IS NULL OR contenu LIKE ? ESCAPE \'\\\')';
        const paramsBase: [string, number, number, string | null, string | null] = [
          conversationId,
          options.depuis,
          options.jusqua,
          motif,
          motif,
        ];

        const total =
          this.db
            .query<{ total: number }, [string, number, number, string | null, string | null]>(
              `SELECT COUNT(*) AS total FROM conversation_evenement WHERE ${clauseBase}`,
            )
            .get(...paramsBase)?.total ?? 0;

        const lignes = this.db
          .query<LigneEvenement, [string, number, number, string | null, string | null, number, number]>(
            `SELECT * FROM conversation_evenement WHERE ${clauseBase} ORDER BY seq ASC LIMIT ? OFFSET ?`,
          )
          .all(...paramsBase, options.limite, options.decalage);

        return { evenements: lignes.map(versEvenement), total };
      },
      { conversationId, ...options },
    );
  }
}
