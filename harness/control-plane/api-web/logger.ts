/**
 * Responsabilité : journal du domaine API web. Un seul point de configuration
 * pino, même motif que `bus-permissions/logger.ts`.
 */

import pino from 'pino';

const LEVEL = process.env['LOG_LEVEL'] ?? 'info';

export const apiWebLogger = pino({
  name: 'api-web',
  level: LEVEL,
  transport:
    process.env['NODE_ENV'] === 'production'
      ? undefined
      : { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } },
});
