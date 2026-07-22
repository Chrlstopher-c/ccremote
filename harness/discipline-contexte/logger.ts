/**
 * Responsabilité : journal du domaine discipline-contexte. Même motif que
 * `control-plane/audit-permissions/logger.ts` — un seul point de configuration pino.
 */

import pino from 'pino'

const LEVEL = process.env['LOG_LEVEL'] ?? 'info'

export const disciplineContexteLogger = pino({
  name: 'discipline-contexte',
  level: LEVEL,
  transport:
    process.env['NODE_ENV'] === 'production'
      ? undefined
      : { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } },
})
