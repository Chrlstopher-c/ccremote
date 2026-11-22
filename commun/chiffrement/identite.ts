// Responsabilité : identité d'un membre du réseau — paire X25519 (échange) et Ed25519 (signature), export, empreinte.
import { ErreurChiffrement } from './erreur.ts';
import { genererPaireDh, importerPubliqueDh, importerPubliqueSignature, octetsDeCle, sha256 } from './cles.ts';
import { estObjet, estPaireDeCles } from './lecture.ts';
import { concatener, depuisBase64url, type Octets, versBase64url } from './octets.ts';

/** Champs JWK d'une clé OKP (X25519 ou Ed25519) telle qu'exportée par WebCrypto. */
export interface JwkOkp {
  readonly kty?: string;
  readonly crv?: string;
  readonly x?: string;
  readonly d?: string;
}

const TAILLE_CLE = 32;
const VERSION_EXPORT = 1;
/** p = 2^255 - 19 : y ≥ p donne une seconde écriture du même point ; refusée pour une identité unique. */
const PREMIER_ED25519 = (1n << 255n) - 19n;

export interface IdentitePublique {
  readonly dh: Uint8Array<ArrayBuffer>;
  readonly signature: Uint8Array<ArrayBuffer>;
}

export interface Identite {
  readonly publique: IdentitePublique;
  readonly dhPrivee: CryptoKey;
  readonly signaturePrivee: CryptoKey;
}

interface IdentitePriveeJson {
  readonly version: number;
  readonly dh: JwkOkp;
  readonly signature: JwkOkp;
}

export function octetsIdentite(id: IdentitePublique): Uint8Array<ArrayBuffer> {
  return concatener(id.dh, id.signature);
}

export async function genererIdentite(): Promise<Identite> {
  const echange = await genererPaireDh(true);
  const signe: unknown = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
  if (!estPaireDeCles(signe)) throw new ErreurChiffrement('génération Ed25519 : paire attendue');
  const publique = { dh: echange.publique, signature: await octetsDeCle(signe.publicKey) };
  return { publique, dhPrivee: echange.privee, signaturePrivee: signe.privateKey };
}

export function exporterIdentitePublique(id: IdentitePublique): string {
  return versBase64url(octetsIdentite(id));
}

function signatureCanonique(octets: Octets): boolean {
  let y = 0n;
  for (let k = TAILLE_CLE - 1; k >= 0; k--) y = (y << 8n) | BigInt(octets[k] ?? 0);
  return (y & ((1n << 255n) - 1n)) < PREMIER_ED25519;
}

/** Valide chaque clé à l'import : clé Ed25519 canonique et décodable en point, clé X25519 de 32 octets. */
export async function importerIdentitePublique(texte: string): Promise<IdentitePublique> {
  const octets = depuisBase64url(texte, 2 * TAILLE_CLE);
  const id = { dh: octets.slice(0, TAILLE_CLE), signature: octets.slice(TAILLE_CLE) };
  if (!signatureCanonique(id.signature)) throw new ErreurChiffrement('clé Ed25519 non canonique');
  try {
    await importerPubliqueDh(id.dh);
    await importerPubliqueSignature(id.signature);
  } catch (cause) {
    throw new ErreurChiffrement(`clé publique refusée : ${String(cause)}`);
  }
  return id;
}

/** Empreinte SHA-256 de l'identité publique : 16 groupes de 4 caractères hexadécimaux, pour l'appairage. */
export async function empreinteIdentite(id: IdentitePublique): Promise<string> {
  const hache = await sha256(octetsIdentite(id));
  const hex = Array.from(hache, (o) => o.toString(16).padStart(2, '0')).join('').toUpperCase();
  return hex.match(/.{4}/g)?.join(' ') ?? '';
}

function lireJwk(valeur: unknown, crv: string): JwkOkp {
  if (!estObjet(valeur) || valeur.kty !== 'OKP' || valeur.crv !== crv) {
    throw new ErreurChiffrement(`clé ${crv} illisible`);
  }
  if (typeof valeur.d !== 'string' || typeof valeur.x !== 'string') {
    throw new ErreurChiffrement(`clé ${crv} privée incomplète`);
  }
  return { kty: 'OKP', crv, d: valeur.d, x: valeur.x };
}

function lireIdentitePriveeJson(valeur: unknown): { dh: JwkOkp; signature: JwkOkp } {
  if (!estObjet(valeur) || valeur.version !== VERSION_EXPORT) {
    throw new ErreurChiffrement('identité privée : version non reconnue');
  }
  return { dh: lireJwk(valeur.dh, 'X25519'), signature: lireJwk(valeur.signature, 'Ed25519') };
}

/** Export de l'identité privée (JWK) pour la conserver ; le texte contient des secrets, il ne se publie jamais. */
export async function exporterIdentitePrivee(id: Identite): Promise<string> {
  const contenu: IdentitePriveeJson = {
    version: VERSION_EXPORT,
    dh: await crypto.subtle.exportKey('jwk', id.dhPrivee),
    signature: await crypto.subtle.exportKey('jwk', id.signaturePrivee),
  };
  return JSON.stringify(contenu);
}

export async function importerIdentitePrivee(texte: string): Promise<Identite> {
  let brut: unknown;
  try {
    brut = JSON.parse(texte);
  } catch (cause) {
    throw new ErreurChiffrement(`identité privée illisible : ${String(cause)}`);
  }
  const { dh, signature } = lireIdentitePriveeJson(brut);
  const dhPrivee = await crypto.subtle.importKey('jwk', dh, { name: 'X25519' }, false, ['deriveBits']);
  const signaturePrivee = await crypto.subtle.importKey('jwk', signature, { name: 'Ed25519' }, false, ['sign']);
  const publique = {
    dh: depuisBase64url(dh.x ?? '', TAILLE_CLE),
    signature: depuisBase64url(signature.x ?? '', TAILLE_CLE),
  };
  return { publique, dhPrivee, signaturePrivee };
}
