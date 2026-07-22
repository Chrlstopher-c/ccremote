/**
 * Responsabilité : journal du domaine « processus orchestrateur » (branche A.1,
 * A.3.2, A.4.2 — mission M-41). Même motif que les autres loggers du dépôt.
 */

import pino from 'pino';

const LEVEL = process.env['LOG_LEVEL'] ?? 'info';

export const processusOrchestrateurLogger = pino({
  name: 'orchestrateur/processus',
  level: LEVEL,
  transport:
    process.env['NODE_ENV'] === 'production'
      ? undefined
      : { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } },
});
