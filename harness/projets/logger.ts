/**
 * Responsabilité : journal du domaine « projets ». Un seul point de configuration pino,
 * mêmes conventions que `workers/logger.ts` (F.4 — pas de configuration globale mutable
 * partagée, mais rien n'interdit un style de log cohérent entre domaines).
 */

import pino from 'pino';

const LEVEL = process.env['LOG_LEVEL'] ?? 'info';

export const projetsLogger = pino({
  name: 'projets',
  level: LEVEL,
  transport:
    process.env['NODE_ENV'] === 'production'
      ? undefined
      : { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } },
});

/** Journal scopé à un projet, pour tracer chargement/validation de bout en bout. */
export function projetLogger(idProjet: string): pino.Logger {
  return projetsLogger.child({ idProjet });
}

/** Journal scopé à une équipe, pour tracer le cycle de vie de son worktree. */
export function equipeLogger(idEquipe: string): pino.Logger {
  return projetsLogger.child({ idEquipe });
}
