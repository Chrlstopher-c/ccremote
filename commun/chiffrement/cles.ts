// Responsabilité : primitives WebCrypto — paires X25519, échange, dérivation HKDF-SHA256, empreinte SHA-256.
import { ErreurChiffrement } from './erreur.ts';
import { estPaireDeCles } from './lecture.ts';
import type { Octets } from './octets.ts';

export interface PaireDh {
  readonly privee: CryptoKey;
  readonly publique: Uint8Array<ArrayBuffer>;
}

export async function sha256(octets: Octets): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', octets));
}

export async function octetsDeCle(cle: CryptoKey): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await crypto.subtle.exportKey('raw', cle));
}

/** Paire X25519 ; `extractable` vrai seulement pour l'identité, qui doit pouvoir être exportée. */
export async function genererPaireDh(extractable: boolean): Promise<PaireDh> {
  const paire: unknown = await crypto.subtle.generateKey({ name: 'X25519' }, extractable, ['deriveBits']);
  if (!estPaireDeCles(paire)) throw new ErreurChiffrement('génération X25519 : paire attendue');
  return { privee: paire.privateKey, publique: await octetsDeCle(paire.publicKey) };
}

export async function importerPubliqueDh(octets: Octets): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', octets, { name: 'X25519' }, true, []);
}

export async function importerPubliqueSignature(octets: Octets): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', octets, { name: 'Ed25519' }, true, ['verify']);
}

/** Secret X25519 brut (32 octets) entre une clé privée locale et une clé publique distante. */
export async function secretDh(privee: CryptoKey, publique: Octets): Promise<Uint8Array<ArrayBuffer>> {
  const cible = await importerPubliqueDh(publique);
  try {
    return new Uint8Array(await crypto.subtle.deriveBits({ name: 'X25519', public: cible }, privee, 256));
  } catch (cause) {
    throw new ErreurChiffrement(`échange X25519 refusé : ${String(cause)}`);
  }
}

/** HKDF-SHA256 (RFC 5869) : sel et info explicites, longueur en octets (32 par défaut). */
export async function hkdf(
  ikm: Octets,
  sel: Octets,
  info: Octets,
  longueur = 32,
): Promise<Uint8Array<ArrayBuffer>> {
  const base = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: sel, info }, base, longueur * 8);
  return new Uint8Array(bits);
}
