/**
 * Responsabilité : journal du domaine « rappels ». Même motif que
 * `mcp-controle/logger.ts`.
 */

import pino from 'pino';

const LEVEL = process.env['LOG_LEVEL'] ?? 'info';

export const rappelsLogger = pino({
  name: 'rappels',
  level: LEVEL,
  transport:
    process.env['NODE_ENV'] === 'production'
      ? undefined
      : { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } },
});
