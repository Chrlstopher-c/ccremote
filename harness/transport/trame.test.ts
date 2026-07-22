import { describe, expect, test } from 'bun:test';
import {
  ErreurTrameInvalide,
  TAG,
  decoderExit,
  decoderTexte,
  decoderTrame,
  encoderExit,
  encoderTexte,
  encoderTrame,
  versUint8Array,
} from './trame.ts';

describe('trame — codec binaire du canal multiplexé', () => {
  test('aller-retour encode/decode préserve tag, seq et payload', () => {
    const payload = encoderTexte('bonjour');
    const brut = encoderTrame(TAG.STDOUT, 42, payload);
    const decodee = decoderTrame(brut);
    expect(decodee.tag).toBe(TAG.STDOUT);
    expect(decodee.seq).toBe(42);
    expect(decoderTexte(decodee.payload)).toBe('bonjour');
  });

  test('payload vide valide (ex. KILL sans argument)', () => {
    const brut = encoderTrame(TAG.KILL, 0, new Uint8Array(0));
    const decodee = decoderTrame(brut);
    expect(decodee.payload.length).toBe(0);
  });

  test('trame trop courte pour porter un en-tête lève ErreurTrameInvalide', () => {
    expect(() => decoderTrame(new Uint8Array(3))).toThrow(ErreurTrameInvalide);
  });

  test('payload tronqué (longueur annoncée > octets reçus) lève — échec bruyant', () => {
    const brut = encoderTrame(TAG.STDOUT, 0, encoderTexte('1234567890'));
    const tronque = brut.subarray(0, brut.length - 5);
    expect(() => decoderTrame(tronque)).toThrow(ErreurTrameInvalide);
  });

  test('EXIT code+signal survit à l’aller-retour JSON', () => {
    const payload = encoderExit({ code: 1, signal: null });
    expect(decoderExit(payload)).toEqual({ code: 1, signal: null });
  });

  test('EXIT payload non-objet est rejeté explicitement', () => {
    expect(() => decoderExit(encoderTexte('"pas un objet"'))).toThrow(ErreurTrameInvalide);
  });

  test('versUint8Array accepte Uint8Array et ArrayBuffer, rejette le reste', () => {
    const original = new Uint8Array([1, 2, 3]);
    expect(versUint8Array(original)).toBe(original);
    expect([...versUint8Array(original.buffer)]).toEqual([1, 2, 3]);
    expect(() => versUint8Array('texte')).toThrow(ErreurTrameInvalide);
  });
});
