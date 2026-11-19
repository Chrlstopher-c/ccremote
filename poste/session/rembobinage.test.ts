import { describe, expect, test } from 'bun:test';
import { pointDeRembobinage } from './rembobinage.ts';

describe('pointDeRembobinage', () => {
  test('le premier message de la conversation : repart de zéro, sans refus', () => {
    const entrees = [
      { type: 'user', uuid: 'm1' },
      { type: 'assistant', uuid: 'r1' },
    ];
    expect(pointDeRembobinage(entrees, 'm1')).toEqual({ tag: 'premier' });
  });

  test('un message plus loin : la reprise part de l’entrée qui le précède', () => {
    const entrees = [
      { type: 'user', uuid: 'm1' },
      { type: 'assistant', uuid: 'r1' },
      { type: 'user', uuid: 'm2' },
    ];
    expect(pointDeRembobinage(entrees, 'm2')).toEqual({ tag: 'point', uuid: 'r1' });
  });

  test('un message inconnu ou une réponse : absent', () => {
    const entrees = [
      { type: 'user', uuid: 'm1' },
      { type: 'assistant', uuid: 'r1' },
    ];
    expect(pointDeRembobinage(entrees, 'r1').tag).toBe('absent');
    expect(pointDeRembobinage(entrees, 'nope').tag).toBe('absent');
  });
});
