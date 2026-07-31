/**
 * Responsabilité : journal du domaine « clôture ». Même motif que
 * `rappels/logger.ts`.
 */

import pino from 'pino';

const LEVEL = process.env['LOG_LEVEL'] ?? 'info';

export const clotureLogger = pino({
  name: 'cloture',
  level: LEVEL,
  transport:
    process.env['NODE_ENV'] === 'production'
      ? undefined
      : { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } },
});
