/**
 * Responsabilité : implémentation réelle du contrat `SessionStore` du SDK (E.3, mission M-31),
 * adossée à SQLite (H-21, E.3.4).
 *
 * Principe directeur : ce store est un MIROIR best-effort (H-15). La vérité reste le disque
 * du PC (H.3.1). Cet adaptateur ne prétend jamais l'inverse : toute erreur d'écriture est
 * loguée, propagée (jamais avalée) et enregistrée dans `session_defaillance` — c'est cette
 * dernière trace, indépendante du flux SDK, qui rend une divergence miroir/vérité détectable
 * après coup plutôt que silencieuse (voir `defaillances.ts`).
 *
 * ☠ Ce module n'importe PAS `test-harness/` (règle du dépôt). Le `Horloge` défini ici est
 * une interface locale minimale, uniquement pour permettre l'injection d'un temps déterministe
 * dans les tests de ce module — sans dépendre de l'horloge simulée du harness de pannes.
 */

import type { Database } from 'bun:sqlite';
import type {
  SessionKey,
  SessionStore,
  SessionStoreEntry,
  SessionSummaryEntry,
} from '@anthropic-ai/claude-agent-sdk';
import { executerAsync } from './journal.ts';
import { normaliserSousChemin } from './clef.ts';
import { DepotEntrees } from './entrees.ts';
import { DepotSommaire } from './sommaire.ts';
import { DepotDefaillances, type Defaillance } from './defaillances.ts';

export type { Defaillance } from './defaillances.ts';

/** Source de temps injectable — défaut `Date.now`. Nécessaire pour H.3.2 (mtime du store). */
export interface Horloge {
  maintenant(): number;
}

const HORLOGE_SYSTEME: Horloge = { maintenant: () => Date.now() };

/**
 * Vue de santé du miroir pour une clé donnée. N'appartient PAS au contrat SDK — c'est
 * l'instrument d'observation que la réconciliation (E.1.4, M-30) et l'UI consomment pour
 * répondre à « ce miroir est-il fiable ? » sans jamais avoir à le supposer.
 */
export interface EtatMiroir {
  readonly derniereEcritureA: number | null;
  readonly defaillances: readonly Defaillance[];
  /** Signal univoque, jamais un seuil de fraîcheur devinable : au moins un lot abandonné. */
  readonly divergent: boolean;
}

export class SessionStoreSqlite implements SessionStore {
  readonly #db: Database;
  readonly #entrees: DepotEntrees;
  readonly #sommaire: DepotSommaire;
  readonly #defaillances: DepotDefaillances;
  readonly #horloge: Horloge;

  constructor(db: Database, horloge: Horloge = HORLOGE_SYSTEME) {
    this.#db = db;
    this.#entrees = new DepotEntrees(db);
    this.#sommaire = new DepotSommaire(db);
    this.#defaillances = new DepotDefaillances(db);
    this.#horloge = horloge;
  }

  /**
   * Appelée par le SDK après succès de l'écriture locale (E.3.1). Toute exception ici
   * est enregistrée comme défaillance puis RE-LANCÉE : c'est ce qui permet à la politique
   * de retry du SDK (3 tentatives, timeout 60 s non réessayé) de s'exercer normalement.
   */
  public async append(cle: SessionKey, entrees: SessionStoreEntry[]): Promise<void> {
    const sousChemin = normaliserSousChemin(cle);
    return executerAsync(
      'adaptateur.append',
      async () => {
        try {
          this.#ecrireTransactionnellement(cle, sousChemin, entrees);
        } catch (cause) {
          this.#defaillances.enregistrer(
            cle.projectKey,
            cle.sessionId,
            sousChemin,
            decrireCause(cause),
            this.#horloge.maintenant(),
          );
          throw cause;
        }
      },
      { projectKey: cle.projectKey, sessionId: cle.sessionId, sousChemin, taille: entrees.length },
    );
  }

  public async load(cle: SessionKey): Promise<SessionStoreEntry[] | null> {
    const sousChemin = normaliserSousChemin(cle);
    return executerAsync(
      'adaptateur.load',
      async () => {
        const trouvees = this.#entrees.charger(cle.projectKey, cle.sessionId, sousChemin);
        return trouvees ? [...trouvees] : null;
      },
      { projectKey: cle.projectKey, sessionId: cle.sessionId, sousChemin },
    );
  }

  public async listSessions(projectKey: string): Promise<Array<{ sessionId: string; mtime: number }>> {
    return executerAsync(
      'adaptateur.listSessions',
      async () => this.#sommaire.listerParProjet(projectKey).map((s) => ({ sessionId: s.sessionId, mtime: s.mtime })),
      { projectKey },
    );
  }

  public async listSessionSummaries(projectKey: string): Promise<SessionSummaryEntry[]> {
    return executerAsync(
      'adaptateur.listSessionSummaries',
      async () => [...this.#sommaire.listerParProjet(projectKey)],
      { projectKey },
    );
  }

  /** Implémentée (contrairement à l'optionnel du contrat) — évite la panne #8. */
  public async delete(cle: SessionKey): Promise<void> {
    const sousChemin = normaliserSousChemin(cle);
    return executerAsync(
      'adaptateur.delete',
      async () => {
        this.#entrees.supprimer(cle.projectKey, cle.sessionId, sousChemin);
        if (this.#entrees.estPrincipal(sousChemin)) this.#sommaire.supprimer(cle.projectKey, cle.sessionId);
      },
      { projectKey: cle.projectKey, sessionId: cle.sessionId, sousChemin },
    );
  }

  /** Implémentée (contrairement à l'optionnel du contrat) — évite la panne #4. */
  public async listSubkeys(cle: { projectKey: string; sessionId: string }): Promise<string[]> {
    return executerAsync(
      'adaptateur.listSubkeys',
      async () => [...this.#entrees.listerSousCles(cle.projectKey, cle.sessionId)],
      { projectKey: cle.projectKey, sessionId: cle.sessionId },
    );
  }

  /**
   * Hors contrat SDK. Répond factuellement à « ce miroir a-t-il des trous ? » — jamais en
   * lissant un échec passé, toujours en l'exposant (principe directeur de la mission).
   */
  public etatMiroir(cle: SessionKey): EtatMiroir {
    const sousChemin = normaliserSousChemin(cle);
    const derniereEcritureA = this.#entrees.derniereEcritureA(cle.projectKey, cle.sessionId, sousChemin);
    const defaillances = this.#defaillances.lister(cle.projectKey, cle.sessionId);
    return { derniereEcritureA, defaillances, divergent: defaillances.length > 0 };
  }

  /**
   * Transaction unique : les entrées ET le pli du sommaire (H.3.2) dans le même commit
   * SQLite. C'est ce qui sérialise deux `append()` concurrents sur la même session sans
   * verrou applicatif — SQLite ne laisse qu'un seul écrivain progresser à la fois — et
   * garantit qu'un échec du pli n'écrit jamais les entrées orphelines d'un sommaire à jour.
   */
  #ecrireTransactionnellement(
    cle: SessionKey,
    sousChemin: string,
    lot: readonly SessionStoreEntry[],
  ): void {
    const ecritA = this.#horloge.maintenant();
    const transaction = this.#db.transaction(() => {
      this.#entrees.ajouter(cle.projectKey, cle.sessionId, sousChemin, lot, ecritA);
      if (this.#entrees.estPrincipal(sousChemin)) {
        this.#sommaire.plierEtEcrire(cle, lot, ecritA);
      }
    });
    transaction();
  }
}

function decrireCause(cause: unknown): string {
  if (cause instanceof Error) return cause.message;
  return String(cause);
}
