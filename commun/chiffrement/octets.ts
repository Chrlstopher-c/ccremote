// Responsabilité : octets sans ambiguïté — base64url, compteurs 64 bits, transcription à longueurs préfixées.
import { ErreurChiffrement } from './erreur.ts';

/** Octets destinés à WebCrypto : BufferSource exige un ArrayBuffer (et non un ArrayBufferLike). */
export type Octets = Uint8Array<ArrayBuffer>;

const ENCODEUR = new TextEncoder();
export const TAILLE_COMPTEUR = 8;
const TAILLE_LONGUEUR = 4;

export function enOctets(texte: string): Uint8Array<ArrayBuffer> {
  return ENCODEUR.encode(texte);
}

export function versBase64url(octets: Octets): string {
  let binaire = '';
  for (const o of octets) binaire += String.fromCharCode(o);
  return btoa(binaire).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function depuisBase64url(texte: string, longueur?: number): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]*$/.test(texte)) throw new ErreurChiffrement('base64url invalide');
  const base64 = texte.replace(/-/g, '+').replace(/_/g, '/');
  const complet = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  let binaire: string;
  try {
    binaire = atob(complet);
  } catch (cause) {
    throw new ErreurChiffrement(`base64url mal formé : ${String(cause)}`);
  }
  const octets = new Uint8Array(binaire.length);
  for (let k = 0; k < binaire.length; k++) octets[k] = binaire.charCodeAt(k);
  if (longueur !== undefined && octets.length !== longueur) {
    throw new ErreurChiffrement(`longueur ${octets.length} au lieu de ${longueur}`);
  }
  return octets;
}

export function concatener(...morceaux: readonly Octets[]): Uint8Array<ArrayBuffer> {
  const total = morceaux.reduce((somme, m) => somme + m.length, 0);
  const sortie = new Uint8Array(total);
  let position = 0;
  for (const m of morceaux) {
    sortie.set(m, position);
    position += m.length;
  }
  return sortie;
}

function longueurSur4Octets(longueur: number): Uint8Array<ArrayBuffer> {
  const octets = new Uint8Array(TAILLE_LONGUEUR);
  new DataView(octets.buffer).setUint32(0, longueur);
  return octets;
}

/** Chaque morceau est précédé de sa longueur sur 4 octets : deux découpages ne donnent jamais le même texte. */
export function transcription(...morceaux: readonly Octets[]): Uint8Array<ArrayBuffer> {
  return concatener(...morceaux.flatMap((m) => [longueurSur4Octets(m.length), m]));
}

export function compteurOctets(valeur: number): Uint8Array<ArrayBuffer> {
  const octets = new Uint8Array(TAILLE_COMPTEUR);
  new DataView(octets.buffer).setBigUint64(0, BigInt(valeur));
  return octets;
}

/** Lit un compteur sur les 8 premiers octets ; l'appelant vérifie la longueur avant. */
export function lireCompteur(octets: Octets): number {
  return Number(new DataView(octets.buffer, octets.byteOffset, TAILLE_COMPTEUR).getBigUint64(0));
}
