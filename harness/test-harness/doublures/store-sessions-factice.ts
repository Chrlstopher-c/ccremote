// Doublure de `SessionStore` reproduisant fidèlement la politique d'échec E.3.3 :
// rejet réessayé 3×, timeout 60 s NON réessayé, lot abandonné, `mirror_error` émis,
// sous-processus inaffecté. Aucun accès disque : tout est en mémoire.

import type {
  EntreeSession,
  MessageMiroirErreur,
  StoreObservable,
} from '../contrats/session-store.ts';
import { REESSAIS_SUR_REJET, TIMEOUT_STORE_MS } from '../contrats/session-store.ts';
import type { Horloge } from '../contrats/horloge.ts';
import type { JournalPannes } from '../journal/journal-pannes.ts';

const BACKOFF_MS = 200;

export interface OptionsStore {
  /** #4 : sans `listSubkeys`, la reprise perd les transcripts de sous-agents. */
  readonly listSubkeysImplementee: boolean;
  /** #8 : sans `delete`, la suppression est un no-op silencieux. */
  readonly deleteImplementee: boolean;
}

export const OPTIONS_STORE_SAINES: OptionsStore = {
  listSubkeysImplementee: true,
  deleteImplementee: true,
};

type Panne = 'rejet' | 'timeout';

export class StoreSessionsFactice implements StoreObservable {
  #sousProcessusActif = true;
  #lotsAbandonnes = 0;
  #tentatives = 0;
  readonly #pannes: Panne[] = [];
  readonly #miroirErreurs: MessageMiroirErreur[] = [];
  readonly #donnees = new Map<string, EntreeSession[]>();
  readonly #sousCles = new Map<string, string[]>();

  /** Absente quand l'option est désactivée — c'est tout l'objet de la panne #4. */
  listSubkeys?: (cle: string) => Promise<readonly string[]>;
  /** Absente quand l'option est désactivée — panne #8. */
  delete?: (cle: string) => Promise<void>;

  constructor(
    private readonly horloge: Horloge,
    private readonly journal: JournalPannes,
    options: OptionsStore = OPTIONS_STORE_SAINES,
  ) {
    if (options.listSubkeysImplementee) {
      this.listSubkeys = (cle) => Promise.resolve(this.#sousCles.get(cle) ?? []);
    }
    if (options.deleteImplementee) {
      this.delete = (cle) => {
        this.#donnees.delete(cle);
        this.#sousCles.delete(cle);
        return Promise.resolve();
      };
    }
  }

  /** Programme la panne des `n` prochaines tentatives d'`append`. */
  injecterRejets(nombre: number): void {
    for (let i = 0; i < nombre; i += 1) this.#pannes.push('rejet');
  }

  /** Programme un timeout de 60 s sur la prochaine tentative d'`append`. */
  injecterTimeout(): void {
    this.#pannes.push('timeout');
  }

  async append(cle: string, entrees: readonly EntreeSession[]): Promise<void> {
    for (let essai = 0; essai <= REESSAIS_SUR_REJET; essai += 1) {
      const panne = this.#tenter(cle);
      if (panne === null) {
        this.#fusionner(cle, entrees);
        return;
      }
      if (panne === 'timeout') {
        await this.#abandonner(cle, entrees, 'timeout');
        return;
      }
      await this.horloge.attendre(BACKOFF_MS * (essai + 1));
    }
    await this.#abandonner(cle, entrees, 'rejet_epuise');
  }

  async load(cle: string): Promise<readonly EntreeSession[] | null> {
    return this.#donnees.get(cle) ?? null;
  }

  /** Suppression demandée alors que `delete` n'existe pas ⇒ no-op silencieux (#8). */
  supprimerViaContrat(cle: string): Promise<void> {
    if (this.delete === undefined) {
      this.journal.enregistrer('suppression_no_op', { cle });
      return Promise.resolve();
    }
    return this.delete(cle);
  }

  /** Matérialisation de reprise. Sans `listSubkeys`, le sous-agent est perdu (#4). */
  async materialiserReprise(cle: string): Promise<readonly string[]> {
    if (this.listSubkeys === undefined) {
      this.journal.enregistrer('subkeys_absentes', { cle });
      return [];
    }
    return this.listSubkeys(cle);
  }

  declarerSousCles(cle: string, sousCles: readonly string[]): void {
    this.#sousCles.set(cle, [...sousCles]);
  }

  messagesMiroirErreur(): readonly MessageMiroirErreur[] {
    return this.#miroirErreurs;
  }

  sousProcessusActif(): boolean {
    return this.#sousProcessusActif;
  }

  lotsAbandonnes(): number {
    return this.#lotsAbandonnes;
  }

  tentativesAppend(): number {
    return this.#tentatives;
  }

  entrees(cle: string): readonly EntreeSession[] {
    return this.#donnees.get(cle) ?? [];
  }

  #tenter(cle: string): Panne | null {
    this.#tentatives += 1;
    this.journal.enregistrer('append_tente', { cle, tentative: this.#tentatives });
    const panne = this.#pannes.shift();
    if (panne === undefined) return null;
    if (panne === 'timeout') {
      this.journal.enregistrer('append_timeout', { cle, timeoutMs: TIMEOUT_STORE_MS });
    } else {
      this.journal.enregistrer('append_rejete', { cle });
    }
    return panne;
  }

  /** Le lot part à la poubelle, `mirror_error` est émis, le worker continue. */
  async #abandonner(
    cle: string,
    entrees: readonly EntreeSession[],
    cause: MessageMiroirErreur['cause'],
  ): Promise<void> {
    if (cause === 'timeout') await this.horloge.attendre(TIMEOUT_STORE_MS);
    this.#lotsAbandonnes += 1;
    const message: MessageMiroirErreur = {
      type: 'mirror_error',
      cle,
      cause,
      entreesAbandonnees: entrees.length,
      a: this.horloge.maintenant(),
    };
    this.#miroirErreurs.push(message);
    this.journal.enregistrer('lot_abandonne', { cle, cause, entrees: entrees.length });
    this.journal.enregistrer('mirror_error', { cle, cause });
  }

  /** Idempotence E.3.2 : upsert sur `uuid`, ajout brut sans `uuid`. */
  #fusionner(cle: string, entrees: readonly EntreeSession[]): void {
    const existantes = this.#donnees.get(cle) ?? [];
    for (const entree of entrees) {
      const index =
        entree.uuid === undefined ? -1 : existantes.findIndex((e) => e.uuid === entree.uuid);
      if (index >= 0) existantes[index] = entree;
      else existantes.push(entree);
    }
    this.#donnees.set(cle, existantes);
  }
}
