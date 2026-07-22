/**
 * Responsabilité : journal du domaine « drill d'arrêt d'urgence » (G.4.3).
 * Un seul point de configuration pino, même convention que les autres domaines.
 */

import pino from 'pino';

export const arretUrgenceLogger = pino({
  name: 'arret-urgence',
  level: process.env['LOG_LEVEL'] ?? 'info',
  transport:
    process.env['NODE_ENV'] === 'production'
      ? undefined
      : { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } },
});
