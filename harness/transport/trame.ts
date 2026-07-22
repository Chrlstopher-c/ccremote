/**
 * Responsabilité : codec binaire des trames multiplexées sur la connexion
 * WebSocket (D.1.2). Une trame = [tag:1][seq:4 BE][len:4 BE][payload:len].
 *
 * `☠` Le tag distingue les voies logiques (STDIN/STDOUT = canal principal,
 * H-12 : payload jamais interprété ; STDERR/KILL/EXIT = voie de contrôle,
 * B.2.3 ; ACK = accusé de réception du canal principal, D.2.2 local). Le
 * multiplexage sur une seule connexion physique est un détail d'implémentation
 * — il ne mélange jamais les octets du canal principal avec autre chose.
 */

/** Longueur de l'en-tête : 1 octet de tag + 4 octets de séquence + 4 octets de longueur. */
const TAILLE_ENTETE = 9;

export const TAG = {
  STDIN: 0x01,
  STDOUT: 0x02,
  STDERR: 0x03,
  ACK: 0x04,
  KILL: 0x05,
  EXIT: 0x06,
  ERREUR_SPAWN: 0x07,
} as const;

export type TagTrame = (typeof TAG)[keyof typeof TAG];

export class ErreurTrameInvalide extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ErreurTrameInvalide';
  }
}

export interface TrameDecodee {
  readonly tag: number;
  readonly seq: number;
  readonly payload: Uint8Array;
}

export function encoderTrame(tag: TagTrame, seq: number, payload: Uint8Array): Uint8Array {
  const trame = new Uint8Array(TAILLE_ENTETE + payload.length);
  const vue = new DataView(trame.buffer);
  trame[0] = tag;
  vue.setUint32(1, seq, false);
  vue.setUint32(5, payload.length, false);
  trame.set(payload, TAILLE_ENTETE);
  return trame;
}

export function decoderTrame(brut: Uint8Array): TrameDecodee {
  if (brut.length < TAILLE_ENTETE) {
    throw new ErreurTrameInvalide(`trame trop courte : ${brut.length} octet(s), en-tête = ${TAILLE_ENTETE}`);
  }
  const vue = new DataView(brut.buffer, brut.byteOffset, brut.byteLength);
  const tag = brut[0]!;
  const seq = vue.getUint32(1, false);
  const len = vue.getUint32(5, false);
  const payload = brut.subarray(TAILLE_ENTETE, TAILLE_ENTETE + len);
  if (payload.length !== len) {
    throw new ErreurTrameInvalide(`payload tronqué : longueur annoncée ${len}, reçue ${payload.length}`);
  }
  return { tag, seq, payload };
}

const encodeurTexte = new TextEncoder();
const decodeurTexte = new TextDecoder();

export function encoderTexte(texte: string): Uint8Array {
  return encodeurTexte.encode(texte);
}

export function decoderTexte(payload: Uint8Array): string {
  return decodeurTexte.decode(payload);
}

export interface ExitPayload {
  readonly code: number | null;
  readonly signal: string | null;
}

export function encoderExit(exit: ExitPayload): Uint8Array {
  return encoderTexte(JSON.stringify(exit));
}

export function decoderExit(payload: Uint8Array): ExitPayload {
  const brut: unknown = JSON.parse(decoderTexte(payload));
  if (typeof brut !== 'object' || brut === null) {
    throw new ErreurTrameInvalide('payload EXIT invalide : objet attendu');
  }
  const objet = brut as Record<string, unknown>;
  const code = typeof objet['code'] === 'number' ? objet['code'] : null;
  const signal = typeof objet['signal'] === 'string' ? objet['signal'] : null;
  return { code, signal };
}

/** Normalise ce que peut rendre `WebSocket.onmessage` (ArrayBuffer, vue typée). */
export function versUint8Array(donnee: unknown): Uint8Array {
  if (donnee instanceof Uint8Array) return donnee;
  if (donnee instanceof ArrayBuffer) return new Uint8Array(donnee);
  throw new ErreurTrameInvalide(`type de message WebSocket non pris en charge : ${typeof donnee}`);
}
