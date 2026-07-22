/**
 * Responsabilité : journalisation du registre et enveloppe d'erreur commune.
 * Toute opération touchant SQLite passe par `executer` — try/catch + log garantis.
 */

import pino from 'pino';

export const journal = pino({
  name: 'registre',
  level: process.env['LOG_LEVEL'] ?? 'info',
});

/** Erreur normalisée du registre. Conserve la cause d'origine. */
export class ErreurRegistre extends Error {
  public readonly operation: string;

  constructor(operation: string, cause: unknown) {
    super(`registre: échec de « ${operation} » — ${decrire(cause)}`);
    this.name = 'ErreurRegistre';
    this.operation = operation;
    this.cause = cause;
  }
}

function decrire(cause: unknown): string {
  if (cause instanceof Error) return cause.message;
  return String(cause);
}

/**
 * Exécute une opération SQLite en garantissant try/catch + log.
 * Aucune exception SQLite ne doit sortir du registre sans trace.
 */
export function executer<T>(operation: string, fn: () => T, contexte?: Record<string, unknown>): T {
  try {
    return fn();
  } catch (cause) {
    journal.error({ operation, contexte, err: cause }, 'opération registre en échec');
    throw new ErreurRegistre(operation, cause);
  }
}
