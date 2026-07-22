/**
 * Responsabilité : journal du domaine observabilité. Même motif que les
 * autres loggers du dépôt (`bus-permissions/logger.ts`, `audit-permissions/logger.ts`).
 */

import pino from 'pino';

const LEVEL = process.env['LOG_LEVEL'] ?? 'info';

export const observabiliteLogger = pino({
  name: 'observabilite',
  level: LEVEL,
  transport:
    process.env['NODE_ENV'] === 'production'
      ? undefined
      : { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } },
});
