// Logger du harness (pino). Silencieux par défaut sous `bun test` :
// la surface d'assertion est le journal de faits, pas la sortie console.

import pino from 'pino';

const niveau = process.env.HARNESS_LOG_LEVEL ?? 'silent';

export const logger = pino({
  name: 'test-harness',
  level: niveau,
});
