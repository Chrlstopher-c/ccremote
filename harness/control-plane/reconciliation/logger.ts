/**
 * Responsabilité : journal du domaine réconciliation. Un seul point de configuration pino.
 */

import pino from 'pino';

export const reconciliationLogger = pino({
  name: 'reconciliation',
  level: process.env['LOG_LEVEL'] ?? 'info',
});
