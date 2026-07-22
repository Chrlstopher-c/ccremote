/**
 * Responsabilité : journalisation du module session-store et enveloppe d'erreur commune.
 * Même patron que `control-plane/registre/journal.ts` — un module, un point pino, une
 * erreur normalisée. Ce module ne réimporte pas celui du registre : la frontière entre
 * les deux domaines (E.1 vs E.3) reste explicite (H-21 : composants séparés, même style).
 */

import pino from 'pino';

export const journal = pino({
  name: 'session-store',
  level: process.env['LOG_LEVEL'] ?? 'info',
});

/** Erreur normalisée du store de sessions. Conserve la cause d'origine. */
export class ErreurSessionStore extends Error {
  public readonly operation: string;

  constructor(operation: string, cause: unknown) {
    super(`session-store: échec de « ${operation} » — ${decrire(cause)}`);
    this.name = 'ErreurSessionStore';
    this.operation = operation;
    this.cause = cause;
  }
}

function decrire(cause: unknown): string {
  if (cause instanceof Error) return cause.message;
  return String(cause);
}

/**
 * Exécute une opération SQLite synchrone en garantissant try/catch + log.
 * ☠ Le principe directeur de cette mission : une erreur ne doit jamais se
 * dissoudre en silence dans un miroir qui se prétend fidèle. Toute panne de
 * `append` est loguée ET propagée (jamais avalée) — c'est ce qui permet à la
 * couche SDK de retenter et à la couche réconciliation (E.1.4) de détecter
 * la divergence plutôt que de la découvrir des jours plus tard.
 */
export function executer<T>(operation: string, fn: () => T, contexte?: Record<string, unknown>): T {
  try {
    return fn();
  } catch (cause) {
    journal.error({ operation, contexte, err: cause }, 'opération session-store en échec');
    throw new ErreurSessionStore(operation, cause);
  }
}

/** Variante asynchrone — `append`/`load` sont des `Promise` au contrat SDK. */
export async function executerAsync<T>(
  operation: string,
  fn: () => Promise<T>,
  contexte?: Record<string, unknown>,
): Promise<T> {
  try {
    return await fn();
  } catch (cause) {
    journal.error({ operation, contexte, err: cause }, 'opération session-store en échec');
    throw new ErreurSessionStore(operation, cause);
  }
}
