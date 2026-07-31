/**
 * Responsabilité : journal du domaine « notifications ». Même motif que
 * `mcp-controle/logger.ts`.
 */

import pino from 'pino';

const LEVEL = process.env['LOG_LEVEL'] ?? 'info';

export const notificationsLogger = pino({
  name: 'notifications',
  level: LEVEL,
  transport:
    process.env['NODE_ENV'] === 'production'
      ? undefined
      : { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } },
});
