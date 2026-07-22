/**
 * Responsabilité : journal du domaine `composition` — les deux racines
 * d'assemblage (Pi control-plane, PC superviseur) et leurs points d'entrée
 * exécutables. Même convention que les autres domaines (pino, un seul point
 * de configuration).
 */

import pino from 'pino';

export const compositionLogger = pino({
  name: 'composition',
  level: process.env['LOG_LEVEL'] ?? 'info',
  transport:
    process.env['NODE_ENV'] === 'production'
      ? undefined
      : { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } },
});
