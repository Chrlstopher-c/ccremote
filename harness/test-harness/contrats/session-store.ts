// Contrat `SessionStore` (branche E.3), transposé du SDK 0.3.217.
// Politique d'échec vérifiée (E.3.3) : rejet réessayé 3×, timeout 60 s NON réessayé,
// lot abandonné, message système `mirror_error` émis, sous-processus inaffecté.

export const REESSAIS_SUR_REJET = 3;
export const TIMEOUT_STORE_MS = 60_000;

export interface EntreeSession {
  /** Clé d'idempotence quand elle existe (E.3.2). Absente ⇒ ajout sans dédup. */
  readonly uuid?: string;
  readonly [champ: string]: unknown;
}

export interface MessageMiroirErreur {
  readonly type: 'mirror_error';
  readonly cle: string;
  readonly cause: 'rejet_epuise' | 'timeout';
  readonly entreesAbandonnees: number;
  readonly a: number;
}

export interface StoreSessions {
  append(cle: string, entrees: readonly EntreeSession[]): Promise<void>;
  load(cle: string): Promise<readonly EntreeSession[] | null>;
  /**
   * Transcripts de sous-agents. Non implémentée ⇒ la reprise ne matérialise
   * que le transcript principal, sans erreur (panne #4).
   */
  listSubkeys?(cle: string): Promise<readonly string[]>;
  /**
   * Non implémentée ⇒ suppression acceptée sans rien supprimer (panne #8).
   */
  delete?(cle: string): Promise<void>;
}

/** Ce que le harness observe en plus du contrat SDK, pour assertion. */
export interface StoreObservable extends StoreSessions {
  messagesMiroirErreur(): readonly MessageMiroirErreur[];
  /** Doit rester `true` après tout échec : le sous-processus continue. */
  sousProcessusActif(): boolean;
  lotsAbandonnes(): number;
  tentativesAppend(): number;
}
