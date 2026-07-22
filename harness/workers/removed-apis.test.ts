/**
 * Protège la panne #37 : `TeamCreate`, `TeamDelete` et `team_name` ont été
 * supprimés en CC v2.1.178, et `unstable_v2_*` en SDK 0.3.142 (panne #38).
 * S'appuyer dessus, c'est travailler sur une surface qui n'existe plus — sans
 * erreur au moment de l'écriture.
 */

import { describe, expect, test } from 'bun:test';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const REMOVED_SYMBOLS: readonly string[] = [
  'TeamCreate',
  'TeamDelete',
  'team_name',
  'unstable_v2_createSession',
  'unstable_v2_resumeSession',
  'unstable_v2_prompt',
  'SDKSession',
];

async function moduleSources(): Promise<Array<{ file: string; content: string }>> {
  const dir = dirname(new URL(import.meta.url).pathname);
  const entries = await readdir(dir);
  const sources = entries.filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'));
  return Promise.all(
    sources.map(async (file) => ({ file, content: await readFile(join(dir, file), 'utf8') })),
  );
}

describe('APIs supprimées', () => {
  test('aucun fichier du module ne les référence', async () => {
    const files = await moduleSources();
    expect(files.length).toBeGreaterThan(0);
    const offenders = files.flatMap(({ file, content }) =>
      REMOVED_SYMBOLS.filter((symbol) => content.includes(symbol)).map((symbol) => `${file}: ${symbol}`),
    );
    expect(offenders).toEqual([]);
  });
});
