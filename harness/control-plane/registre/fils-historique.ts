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
 * Normalise pour une comparaison insensible à la casse ET aux accents, dans
 * les deux sens (motif comme contenu). `☠` Le `LIKE` de SQLite ne fait du
 * insensible-à-la-casse que sur l'ASCII, jamais sur les accents (mesuré sur la
 * base réelle : « équipe » 1364 lignes, « ÉQUIPE » 50) — `bun:sqlite` ne
 * permet pas d'enregistrer de fonction SQL custom (pas de `Database.function`,
 * vérifié sur bun 1.3.13) ni de collation utilisable par `LIKE` (les
 * collations SQLite n'affectent pas l'opérateur `LIKE`, seulement `=`/`ORDER
 * BY`) ; `NFD` décompose chaque caractère accentué en lettre de base + marque
 * combinante, qu'on retire ensuite (plage Unicode U+0300–U+036F).
 */
function normaliserRecherche(texte: string): string {
  return texte
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

export class DepotFilsHistorique {
  private readonly db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  /**
   * Fils ayant au moins un événement dans `[depuis, jusqua]`, PLUS les fils
   * SANS AUCUN événement dont la dernière activité de leur propre ligne
   * (`maj_a`) tombe dans la plage — jamais silencieusement absents.
   * Triés par dernière activité décroissante. `☠` Les dates et le compte
   * RENDUS portent sur le fil ENTIER, jamais sur la seule tranche filtrée :
   * le filtre ne sert qu'à choisir QUELS fils apparaissent, pas à tronquer ce
   * qu'on dit d'eux.
   *
   * `☠` `LEFT JOIN` (pas `JOIN`) : un `INNER JOIN` exclut tout fil sans
   * événement de la sortie entière, quelle que soit la plage demandée — mesuré
   * sur la base réelle du Pi, 14 fils sur 108 n'apparaissaient JAMAIS. Pour un
   * fil sans événement, `COALESCE` retombe sur les dates de la ligne
   * `conversation` elle-même (`cree_a`/`maj_a`) : c'est le seul horodatage
   * honnête qu'on ait pour un fil qui n'a rien écrit — assumé comme tel, pas
   * présenté comme un horodatage d'événement. `COUNT(e.seq)`, pas `COUNT(*)` :
   * la ligne `NULL` que produit le `LEFT JOIN` pour un fil vide ne doit pas se
   * compter comme un message.
   */
  public lister(options: OptionsListeFils): readonly ResumeFil[] {
    return executer(
      'filsHistorique.lister',
      () => {
        const lignes = this.db
          .query<LigneResumeFil, [number, number, number, number, number]>(
            `SELECT c.id AS id, c.titre AS titre,
                    COALESCE(MIN(e.cree_a), c.cree_a) AS premier,
                    COALESCE(MAX(e.cree_a), c.maj_a) AS dernier,
                    COUNT(e.seq) AS nb
               FROM conversation c
               LEFT JOIN conversation_evenement e ON e.conversation_id = c.id
              WHERE c.id IN (
                      SELECT DISTINCT conversation_id FROM conversation_evenement
                       WHERE cree_a >= ? AND cree_a <= ?
                    )
                 OR (e.conversation_id IS NULL AND c.maj_a >= ? AND c.maj_a <= ?)
              GROUP BY c.id
              ORDER BY dernier DESC
              LIMIT ?`,
          )
          .all(options.depuis, options.jusqua, options.depuis, options.jusqua, options.limite);
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
   * `☠` La recherche textuelle n'est PLUS un `LIKE` SQL : le `LIKE` de SQLite
   * ne fait de l'insensible-à-la-casse que sur l'ASCII, jamais sur les accents
   * (mesuré sur la base réelle : un même fil rendait 213 correspondances pour
   * « équipe » contre 2 pour « ÉQUIPE »). La plage de dates reste filtrée en
   * SQL (bornée à UN fil, pas un balayage de la table entière) ; la recherche
   * se fait ensuite en JS via `normaliserRecherche` (NFD + retrait des
   * accents + minuscule), appliquée au motif ET au contenu — les deux sens.
   * `bun:sqlite` ne permet pas d'enregistrer de fonction SQL custom pour faire
   * ce filtre côté moteur (pas de `Database.function`, vérifié) ; une
   * solution avec index (FTS5 + tokenizer `unicode61 remove_diacritics 2`,
   * ou une colonne générée normalisée + index dessus) serait plus rapide sur
   * un très gros fil, mais écrirait le schéma — hors contrainte de ce mandat.
   */
  public evenements(conversationId: string, options: OptionsLectureFil): PageEvenementsFil {
    return executer(
      'filsHistorique.evenements',
      () => {
        const lignes = this.db
          .query<LigneEvenement, [string, number, number]>(
            `SELECT * FROM conversation_evenement
              WHERE conversation_id = ? AND cree_a >= ? AND cree_a <= ?
              ORDER BY seq ASC`,
          )
          .all(conversationId, options.depuis, options.jusqua);

        const motif = options.recherche === null ? null : normaliserRecherche(options.recherche);
        const correspondantes =
          motif === null ? lignes : lignes.filter((l) => normaliserRecherche(l.contenu).includes(motif));

        const page = correspondantes.slice(options.decalage, options.decalage + options.limite);
        return { evenements: page.map(versEvenement), total: correspondantes.length };
      },
      { conversationId, ...options },
    );
  }
}
