import { describe, expect, test } from 'bun:test';
import { lireRelaisDistant, VARIABLE_RELAIS_DISTANT, VARIABLE_JETON_DISTANT } from './relais-distant.ts';

describe('relais distant du poste seul', () => {
  test('absent : aucun relais distant, le moteur garde son relais local', () => {
    expect(lireRelaisDistant({})).toBeNull();
    expect(lireRelaisDistant({ [VARIABLE_RELAIS_DISTANT]: '', [VARIABLE_JETON_DISTANT]: '' })).toBeNull();
  });

  test('url ws(s) et jeton de poste lus ensemble', () => {
    const env = { [VARIABLE_RELAIS_DISTANT]: 'wss://relais.exemple.test/poste', [VARIABLE_JETON_DISTANT]: 'jeton-factice' };
    expect(lireRelaisDistant(env)).toEqual({ url: 'wss://relais.exemple.test/poste', jeton: 'jeton-factice' });
  });

  test('refuse une adresse qui n’est pas ws:// ou wss://', () => {
    const env = { [VARIABLE_RELAIS_DISTANT]: 'https://relais.exemple.test', [VARIABLE_JETON_DISTANT]: 'x' };
    expect(() => lireRelaisDistant(env)).toThrow(VARIABLE_RELAIS_DISTANT);
  });

  test('refuse une url sans jeton, et un jeton sans url', () => {
    expect(() => lireRelaisDistant({ [VARIABLE_RELAIS_DISTANT]: 'ws://relais.exemple.test/poste' })).toThrow(
      VARIABLE_JETON_DISTANT,
    );
    expect(() => lireRelaisDistant({ [VARIABLE_JETON_DISTANT]: 'x' })).toThrow(VARIABLE_RELAIS_DISTANT);
  });
});
