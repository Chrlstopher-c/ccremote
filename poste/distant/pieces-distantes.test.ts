import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pino from 'pino';
import { Stockage } from '../presentation/stockage.ts';
import { stockeurPieces } from './pieces-distantes.ts';

const racine = mkdtempSync(join(tmpdir(), 'quart-pieces-distantes-'));
afterEach(() => rmSync(racine, { recursive: true, force: true }));

test('image et document d’une session « cse_… » stockés, relus, sans doublon', () => {
  const stockage = new Stockage(racine);
  const p = stockeurPieces(stockage, 'cse_01FauxIdentifiantTest', pino({ enabled: false }));
  const img = p.image({ mime: 'image/png', base64: 'iVBORw0KGgo=' }, 0, 'utilisateur');
  const encore = p.image({ mime: 'image/png', base64: 'iVBORw0KGgo=' }, 0, 'utilisateur');
  const doc = p.document({ mime: 'application/pdf', base64: Buffer.from('%PDF').toString('base64') }, 0, null);
  expect(img).toMatchObject({ type: 'image', origine: 'utilisateur' });
  expect(encore).toEqual(img);
  expect(doc).toMatchObject({ type: 'fichier', nom: 'document-1.pdf', mode: 'joindre' });
  const id = doc?.type === 'fichier' ? doc.fichier : '';
  expect(stockage.lire('cse_01FauxIdentifiantTest', id)?.octets.toString()).toBe('%PDF');
});
