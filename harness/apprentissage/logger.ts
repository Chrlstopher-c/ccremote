/**
 * Responsabilité : journal du domaine apprentissage et enveloppe d'erreur commune.
 * Toute opération touchant SQLite ou le disque passe par `executer` — try/catch + log garantis.
 *
 * Conception inspirée de Hermes Agent (Nous Research) — MIT. Transposition indépendante en TypeScript.
 */

import pino from 'pino';

export const journal = pino({
  name: 'apprentissage',
  level: process.env['LOG_LEVEL'] ?? 'info',
  transport:
    process.env['NODE_ENV'] === 'production'
      ? undefined
      : { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } },
});

/** Erreur normalisée du domaine apprentissage. Conserve la cause d'origine. */
export class ErreurApprentissage extends Error {
  public readonly operation: string;

  constructor(operation: string, cause: unknown) {
    super(`apprentissage: échec de « ${operation} » — ${decrire(cause)}`);
    this.name = 'ErreurApprentissage';
    this.operation = operation;
    this.cause = cause;
  }
}

function decrire(cause: unknown): string {
  if (cause instanceof Error) return cause.message;
  return String(cause);
}

/**
 * Exécute une opération (SQLite, disque, réseau) en garantissant try/catch + log.
 * Aucune exception du domaine ne doit sortir sans trace (standard maison).
 */
export function executer<T>(operation: string, fn: () => T, contexte?: Record<string, unknown>): T {
  try {
    return fn();
  } catch (cause) {
    journal.error({ operation, contexte, err: cause }, 'opération apprentissage en échec');
    throw new ErreurApprentissage(operation, cause);
  }
}
