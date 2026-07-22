/**
 * Responsabilité : journal du domaine pause/reprise. Un seul point de configuration pino.
 */

import pino from 'pino';

const LEVEL = process.env['LOG_LEVEL'] ?? 'info';

export const pauseLogger = pino({
  name: 'pause',
  level: LEVEL,
  transport:
    process.env['NODE_ENV'] === 'production'
      ? undefined
      : { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } },
});

/** Journal scopé à une session, pour tracer une pause de bout en bout. */
export function pauseSessionLogger(sessionId: string): pino.Logger {
  return pauseLogger.child({ sessionId });
}
