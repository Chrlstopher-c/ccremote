/**
 * Responsabilité : journal du domaine bus de permissions. Un seul point de
 * configuration pino, même motif que `transport/logger.ts`.
 */

import pino from 'pino';

const LEVEL = process.env['LOG_LEVEL'] ?? 'info';

export const busPermissionsLogger = pino({
  name: 'bus-permissions',
  level: LEVEL,
  transport:
    process.env['NODE_ENV'] === 'production'
      ? undefined
      : { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } },
});
