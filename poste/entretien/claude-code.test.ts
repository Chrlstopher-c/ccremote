// Responsabilité : tests des versions de Claude Code (extraction, absence de CLI, SDK présent).
import { describe, expect, test } from 'bun:test';
import type { Logger } from 'pino';
import { extraireVersion, versionCli, versionSdk } from './claude-code.ts';

const JOURNAL = { warn: () => undefined } as unknown as Logger;

describe('versions de Claude Code', () => {
  test('numéro extrait de la sortie de --version', () => {
    expect(extraireVersion('2.0.31 (Claude Code)\n')).toBe('2.0.31');
    expect(extraireVersion('rien à voir')).toBeNull();
  });

  test('pas de CLI, ou un exécutable qui n’existe pas : null, sans lever d’erreur', async () => {
    expect(await versionCli(null, JOURNAL)).toBeNull();
    expect(await versionCli('/chemin/inexistant/claude', JOURNAL)).toBeNull();
  });

  test('la version du SDK vient du paquet installé', () => {
    expect(versionSdk(JOURNAL)).toMatch(/^\d+\.\d+\.\d+/);
  });
});
