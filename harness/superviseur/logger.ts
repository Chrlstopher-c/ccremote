/**
 * Responsabilité : journal du domaine superviseur (branche B, D.3). Un seul point
 * de configuration pino, même convention que `workers/logger.ts`.
 */

import pino from 'pino';

export const superviseurLogger = pino({
  name: 'superviseur',
  level: process.env['LOG_LEVEL'] ?? 'info',
  transport:
    process.env['NODE_ENV'] === 'production'
      ? undefined
      : { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } },
});

/** Journal scopé à une mission, pour tracer un worker de bout en bout. */
export function missionLogger(missionId: string): pino.Logger {
  return superviseurLogger.child({ missionId });
}
