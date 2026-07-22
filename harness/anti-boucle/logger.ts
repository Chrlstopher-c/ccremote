/**
 * Responsabilité : journal du domaine anti-boucle (H-68, mission M-53). Un seul point
 * de configuration pino, même convention que `superviseur/logger.ts` et `workers/logger.ts`.
 */

import pino from 'pino';

export const antiBoucleLogger = pino({
  name: 'anti-boucle',
  level: process.env['LOG_LEVEL'] ?? 'info',
  transport:
    process.env['NODE_ENV'] === 'production'
      ? undefined
      : { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } },
});

/** Journal scopé à une mission, pour tracer une inspection de bout en bout. */
export function missionLogger(missionId: string): pino.Logger {
  return antiBoucleLogger.child({ missionId });
}
