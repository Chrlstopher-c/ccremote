/**
 * Responsabilité : journal du domaine audit-permissions. Même motif que
 * `bus-permissions/logger.ts` — un seul point de configuration pino.
 */

import pino from 'pino';

const LEVEL = process.env['LOG_LEVEL'] ?? 'info';

export const auditPermissionsLogger = pino({
  name: 'audit-permissions',
  level: LEVEL,
  transport:
    process.env['NODE_ENV'] === 'production'
      ? undefined
      : { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } },
});
