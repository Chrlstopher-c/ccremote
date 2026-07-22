/**
 * Responsabilité : journal du domaine worker. Un seul point de configuration pino.
 */

import pino from 'pino';

const LEVEL = process.env['LOG_LEVEL'] ?? 'info';

export const workerLogger = pino({
  name: 'workers',
  level: LEVEL,
  transport:
    process.env['NODE_ENV'] === 'production'
      ? undefined
      : { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } },
});

/** Journal scopé à une session, pour tracer un worker de bout en bout. */
export function sessionLogger(sessionId: string): pino.Logger {
  return workerLogger.child({ sessionId });
}
