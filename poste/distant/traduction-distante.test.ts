import { describe, expect, test } from 'bun:test';
import { nouvelEtatTraduction } from '../session/traduction-sdk.ts';
import { traduireLot } from './traduction-distante.ts';
import type { EvenementBrut } from './donnees.ts';

const brute = (payload: unknown): EvenementBrut => ({ id: crypto.randomUUID(), payload, creeLe: '2026-11-20T00:00:00Z' });

describe('traduction du fil claude.ai', () => {
  test('un message tapé par Chris devient un message du fil', () => {
    const lot = traduireLot([brute({ type: 'user', uuid: 'u1', message: { role: 'user', content: 'Bonjour' } })],
      nouvelEtatTraduction());
    expect(lot.map((e) => e.evt)).toEqual([{ type: 'message', texte: 'Bonjour', uuid: 'u1' }]);
  });
  test('un retour d’outil ou un message méta ne devient pas un message', () => {
    const outil = { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'x' }] } };
    const meta = { type: 'user', isMeta: true, message: { role: 'user', content: 'interne' } };
    const lot = traduireLot([brute(outil), brute(meta)], nouvelEtatTraduction());
    expect(lot.filter((e) => e.evt.type === 'message')).toEqual([]);
  });
});
