/**
 * Responsabilité : demandes de rallonge du plafond d'autonomie (migration 27) —
 * ce qu'un fil dépose quand il veut lancer plus longtemps sans clic.
 *
 * `☠` Ce dépôt n'accorde JAMAIS rien : `trancher` change le statut de la
 * demande, il n'écrit pas `conversation.plafond_autonomie`. C'est l'APPELANT
 * (route API) qui, après un `trancher(..., 'accordee', ...)` réussi, applique
 * le réglage via `conversations.reglerPlafondAutonomie` — deux écritures
 * distinctes, jamais fusionnées, parce qu'une demande accordée et un plafond
 * appliqué sont deux faits différents et que le second doit pouvoir être
 * rejoué sans redemander à l'opérateur de re-cliquer.
 */

import type { Database } from 'bun:sqlite';
import { executer } from './journal.ts';
import {
  JETON_ILLIMITE,
  lireReglagePlafond,
  type ReglagePlafond,
} from '../autonomie/reglage-plafond.ts';
import type { DemandeRallonge, StatutDemandeRallonge } from './types.ts';

interface LigneDemandeRallonge {
  id: string;
  conversation_id: string;
  plafond_demande: string | null;
  fenetre_debut: number | null;
  fenetre_fin: number | null;
  fenetre_objectif: string | null;
  motif: string;
  statut: string;
  cree_a: number;
  maj_a: number;
  detail: string | null;
}

/**
 * Forme stockée en base pour un réglage DEMANDÉ. `☠` `herite` n'a pas de forme
 * ici — jamais `NULL`, contrairement à `ecrireReglagePlafond` (colonne
 * `conversation.plafond_autonomie`) : une demande de rallonge qui « demande
 * d'hériter » est un bug de l'appelant, pas un état représentable. L'outil MCP
 * refuse `herite` AVANT d'atteindre ce dépôt (voir `outils-rallonge.ts`) ; ce
 * garde-fou est le second filet, pas le premier.
 */
function versTexteRallonge(reglage: ReglagePlafond): string {
  if (reglage.type === 'herite') {
    throw new Error('une demande de rallonge ne peut pas porter « herite » — invariant violé par l’appelant');
  }
  return reglage.type === 'illimite' ? JETON_ILLIMITE : String(reglage.max);
}

function versDemandeRallonge(l: LigneDemandeRallonge): DemandeRallonge {
  return {
    id: l.id,
    conversationId: l.conversation_id,
    // `☠` `null` en base ⇒ `null` ici, jamais `herite` : la demande ne porte
    // pas sur le plafond, et l'accorder ne doit RIEN écrire dans cette colonne.
    plafondDemande: l.plafond_demande === null ? null : lireReglagePlafond(l.plafond_demande),
    fenetreDebut: l.fenetre_debut,
    fenetreFin: l.fenetre_fin,
    fenetreObjectif: l.fenetre_objectif,
    motif: l.motif,
    // as : colonne sous CHECK IN ('en_attente','accordee','refusee').
    statut: l.statut as StatutDemandeRallonge,
    detail: l.detail,
    creeA: l.cree_a,
    majA: l.maj_a,
  };
}

export interface CreationDemandeRallonge {
  readonly id: string;
  readonly conversationId: string;
  /** `null` ⇒ la demande ne touche pas au plafond (migration 29). */
  readonly plafondDemande: ReglagePlafond | null;
  /** Plage demandée (migration 29). Les deux ou aucune — le CHECK le refuse sinon. */
  readonly fenetreDebut?: number | null;
  readonly fenetreFin?: number | null;
  readonly fenetreObjectif?: string | null;
  readonly motif: string;
}

export class DepotRallonges {
  private readonly db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  public creer(creation: CreationDemandeRallonge, maintenant: number = Date.now()): DemandeRallonge {
    return executer(
      'rallonges.creer',
      () => {
        this.db
          .query(
            `INSERT INTO demande_rallonge
               (id, conversation_id, plafond_demande, fenetre_debut, fenetre_fin, fenetre_objectif,
                motif, statut, cree_a, maj_a, detail)
             VALUES (?, ?, ?, ?, ?, ?, ?, 'en_attente', ?, ?, NULL)`,
          )
          .run(
            creation.id,
            creation.conversationId,
            creation.plafondDemande === null ? null : versTexteRallonge(creation.plafondDemande),
            creation.fenetreDebut ?? null,
            creation.fenetreFin ?? null,
            creation.fenetreObjectif ?? null,
            creation.motif,
            maintenant,
            maintenant,
          );
        const d = this.lire(creation.id);
        if (!d) throw new Error(`demande de rallonge « ${creation.id} » introuvable après écriture`);
        return d;
      },
      { id: creation.id },
    );
  }

  public lire(id: string): DemandeRallonge | null {
    return executer(
      'rallonges.lire',
      () => {
        const ligne = this.db
          .query<LigneDemandeRallonge, [string]>('SELECT * FROM demande_rallonge WHERE id = ?')
          .get(id);
        return ligne ? versDemandeRallonge(ligne) : null;
      },
      { id },
    );
  }

  /** Demandes en attente — de tout le parc, ou d'un seul fil si `conversationId` est fourni. */
  public enAttente(conversationId?: string): readonly DemandeRallonge[] {
    return executer(
      'rallonges.enAttente',
      () => {
        const lignes =
          conversationId === undefined
            ? this.db
                .query<LigneDemandeRallonge, []>(
                  "SELECT * FROM demande_rallonge WHERE statut = 'en_attente' ORDER BY cree_a DESC",
                )
                .all()
            : this.db
                .query<LigneDemandeRallonge, [string]>(
                  "SELECT * FROM demande_rallonge WHERE statut = 'en_attente' AND conversation_id = ? ORDER BY cree_a DESC",
                )
                .all(conversationId);
        return lignes.map(versDemandeRallonge);
      },
      { conversationId },
    );
  }

  /**
   * Tranche une demande. `☠` Même verrou que `propositions.trancher` : ne
   * réussit QUE depuis `en_attente`, sinon un double clic (ou une réponse déjà
   * apportée par un autre canal) trancherait deux fois la même demande. Le
   * `false` doit remonter jusqu'à l'appelant — il ne dit rien de plus qu'un
   * geste arrivé trop tard.
   */
  public trancher(
    id: string,
    statut: Exclude<StatutDemandeRallonge, 'en_attente'>,
    detail: string | null,
    maintenant: number = Date.now(),
  ): boolean {
    return executer(
      'rallonges.trancher',
      () => {
        const res = this.db
          .query(
            `UPDATE demande_rallonge
                SET statut = ?, detail = ?, maj_a = ?
              WHERE id = ? AND statut = 'en_attente'`,
          )
          .run(statut, detail, maintenant, id);
        return res.changes > 0;
      },
      { id, statut },
    );
  }
}
