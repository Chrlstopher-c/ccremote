import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pino from 'pino';
import { lanceurClaude } from './exec.ts';

// Un faux `claude` : un script du dossier de test, désigné par CCREMOTE_CLAUDE (jamais le vrai binaire).
const journal = pino({ level: 'silent' });
let dossier = '';
const ancienne = process.env['CCREMOTE_CLAUDE'];

beforeEach(() => {
  dossier = mkdtempSync(join(tmpdir(), 'exec-'));
});
afterEach(() => {
  if (ancienne === undefined) delete process.env['CCREMOTE_CLAUDE'];
  else process.env['CCREMOTE_CLAUDE'] = ancienne;
  rmSync(dossier, { recursive: true, force: true });
});

function fauxClaude(corps: string): void {
  const chemin = join(dossier, 'claude');
  writeFileSync(chemin, `#!/bin/sh\n${corps}\n`);
  chmodSync(chemin, 0o755);
  process.env['CCREMOTE_CLAUDE'] = chemin;
}

describe('lanceurClaude', () => {
  test('rend la sortie, les erreurs et le code de la commande', async () => {
    fauxClaude('echo "bonjour $1"; echo "détail" >&2; exit 3');
    const r = await lanceurClaude(5_000, journal)(['mcp', 'list']);
    expect(r).toEqual({ code: 3, sortie: 'bonjour mcp\n', erreurs: 'détail\n', delaiDepasse: false });
  });

  test('au-delà du délai : arrêt et délai dépassé', async () => {
    fauxClaude('sleep 5');
    const r = await lanceurClaude(100, journal)(['x']);
    expect(r.delaiDepasse).toBe(true);
  });

  test('binaire absent : code négatif, jamais d’exception', async () => {
    process.env['CCREMOTE_CLAUDE'] = join(dossier, 'inexistant');
    const r = await lanceurClaude(1_000, journal)(['x']);
    expect(r.code).toBeLessThan(0);
  });
});
