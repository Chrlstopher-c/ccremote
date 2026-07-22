/**
 * Responsabilité : journal du domaine transport. Un seul point de configuration pino.
 */

import pino from 'pino';

const LEVEL = process.env['LOG_LEVEL'] ?? 'info';

export const transportLogger = pino({
  name: 'transport',
  level: LEVEL,
  transport:
    process.env['NODE_ENV'] === 'production'
      ? undefined
      : { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } },
});
