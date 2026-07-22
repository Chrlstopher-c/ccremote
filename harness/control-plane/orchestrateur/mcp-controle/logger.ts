/**
 * Responsabilité : journal du domaine « serveur MCP de contrôle ». Même motif que
 * `bus-permissions/logger.ts`.
 */

import pino from 'pino';

const LEVEL = process.env['LOG_LEVEL'] ?? 'info';

export const mcpControleLogger = pino({
  name: 'mcp-controle',
  level: LEVEL,
  transport:
    process.env['NODE_ENV'] === 'production'
      ? undefined
      : { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } },
});
