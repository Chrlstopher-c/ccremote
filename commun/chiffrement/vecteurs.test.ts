// Responsabilité : vecteurs de test officiels (RFC 7748 X25519, RFC 5869 HKDF, RFC 8032 Ed25519) contre WebCrypto
// et contre nos primitives (secretDh, hkdf).
import { describe, expect, test } from 'bun:test';
import { hkdf, secretDh } from './cles.ts';
import { depuisBase64url, versBase64url } from './octets.ts';
import type { JwkOkp } from './identite.ts';
import type { Octets } from './octets.ts';

const hexVers = (octets: Octets): string => Buffer.from(octets).toString('hex');
const depuisHex = (texte: string): Uint8Array<ArrayBuffer> => new Uint8Array(Buffer.from(texte, 'hex'));

const jwkOkp = (crv: 'X25519' | 'Ed25519', x: string, d?: string): JwkOkp => ({
  kty: 'OKP',
  crv,
  x: versBase64url(depuisHex(x)),
  ...(d === undefined ? {} : { d: versBase64url(depuisHex(d)) }),
});

describe('X25519 — RFC 7748 §6.1', () => {
  const alicePrive = '77076d0a7318a57d3c16c17251b26645df4c2f87ebc0992ab177fba51db92c2a';
  const alicePub = '8520f0098930a754748b7ddcb43ef75a0dbf3a0d26381af4eba4a98eaa9b4e6a';
  const bobPrive = '5dab087e624a8a4b79e17f8b83800ee66f3bb1292618b6fd1c2f8b27ff88e0eb';
  const bobPub = 'de9edb7d7b7dc1b4d35b61c2ece435373f8343c85b78674dadfc7e146f882b4f';
  const secretAttendu = '4a5d9d5ba4ce2de1728e3bf480350f25e07e21c947d19e3376f09b3c1e161742';

  test('clé publique dérivée de la clé privée d’Alice', async () => {
    const cle = await crypto.subtle.importKey('jwk', jwkOkp('X25519', alicePub, alicePrive), { name: 'X25519' }, true, [
      'deriveBits',
    ]);
    const exportee = await crypto.subtle.exportKey('jwk', cle);
    expect(hexVers(depuisBase64url(exportee.x ?? '', 32))).toBe(alicePub);
  });

  test('secret partagé identique des deux côtés, valeur du RFC', async () => {
    const alice = await crypto.subtle.importKey(
      'jwk',
      jwkOkp('X25519', alicePub, alicePrive),
      { name: 'X25519' },
      true,
      ['deriveBits'],
    );
    const bob = await crypto.subtle.importKey('jwk', jwkOkp('X25519', bobPub, bobPrive), { name: 'X25519' }, true, [
      'deriveBits',
    ]);
    expect(hexVers(await secretDh(alice, depuisHex(bobPub)))).toBe(secretAttendu);
    expect(hexVers(await secretDh(bob, depuisHex(alicePub)))).toBe(secretAttendu);
  });
});

describe('HKDF-SHA256 — RFC 5869 annexe A', () => {
  test('cas 1 : sel et info renseignés, 42 octets', async () => {
    const ikm = depuisHex('0b'.repeat(22));
    const sel = depuisHex('000102030405060708090a0b0c');
    const info = depuisHex('f0f1f2f3f4f5f6f7f8f9');
    const okm = await hkdf(ikm, sel, info, 42);
    expect(hexVers(okm)).toBe(
      '3cb25f25faacd57a90434f64d0362f2a2d2d0a90cf1a5a4c5db02d56ecc4c5bf34007208d5b887185865',
    );
  });

  test('cas 3 : sel et info vides, 42 octets', async () => {
    const okm = await hkdf(depuisHex('0b'.repeat(22)), new Uint8Array(0), new Uint8Array(0), 42);
    expect(hexVers(okm)).toBe(
      '8da4e775a563c18f715f802a063c5a31b8a11f5c5ee1879ec3454e5f3c738d2d9d201395faa4b61a96c8',
    );
  });
});

describe('Ed25519 — RFC 8032 §7.1 (test 1, message vide)', () => {
  const prive = '9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60';
  const publique = 'd75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a';
  const signature = hexVers(
    depuisHex(
      'e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe' +
        '24655141438e7a100b',
    ),
  );

  test('signature de référence vérifiée, signature altérée refusée', async () => {
    const cle = await crypto.subtle.importKey('raw', depuisHex(publique), { name: 'Ed25519' }, true, ['verify']);
    const sig = depuisHex(signature);
    expect(await crypto.subtle.verify('Ed25519', cle, sig, new Uint8Array(0))).toBe(true);
    sig[0] = (sig[0] ?? 0) ^ 1;
    expect(await crypto.subtle.verify('Ed25519', cle, sig, new Uint8Array(0))).toBe(false);
  });

  test('la clé privée du RFC produit la même signature (import JWK)', async () => {
    const cle = await crypto.subtle.importKey('jwk', jwkOkp('Ed25519', publique, prive), { name: 'Ed25519' }, false, [
      'sign',
    ]);
    const sig = await crypto.subtle.sign('Ed25519', cle, new Uint8Array(0));
    expect(hexVers(new Uint8Array(sig))).toBe(signature);
  });
});
