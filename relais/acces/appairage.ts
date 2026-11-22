// Responsabilité : les codes d'appairage — un code à usage unique (10 min), montré par un appareil déjà autorisé ou par
// une commande sur le relais, échangé contre une clé d'appareil. Seule l'empreinte du code est stockée.
import { createHash, randomBytes } from 'node:crypto';

export const DUREE_CODE_MS = 10 * 60 * 1000;
// Sans 0, O, 1, I, L, U : un code se lit et se recopie sans erreur.
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ';
const LONGUEUR = 8;
const LIMITE_OCTET = 256 - (256 % ALPHABET.length); // tirage sans biais

/** Un code neuf, en deux groupes de quatre : XXXX-XXXX. */
export function nouveauCode(): string {
  let brut = '';
  while (brut.length < LONGUEUR) {
    for (const octet of randomBytes(LONGUEUR)) {
      if (octet < LIMITE_OCTET && brut.length < LONGUEUR) brut += ALPHABET[octet % ALPHABET.length];
    }
  }
  return `${brut.slice(0, 4)}-${brut.slice(4)}`;
}

/** Casse, tirets et espaces ignorés : « ab2c d3ef » et « AB2C-D3EF » sont le même code. */
export function normaliserCode(brut: string): string {
  return brut.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function empreinteCode(brut: string): string {
  return createHash('sha256').update(normaliserCode(brut)).digest('hex');
}

/** Un code neuf avec son empreinte et son échéance : tout ce qu'il faut pour le stocker. */
export function codeAppairageNeuf(): { readonly code: string; readonly empreinte: string; readonly expireLe: string } {
  const code = nouveauCode();
  return { code, empreinte: empreinteCode(code), expireLe: new Date(Date.now() + DUREE_CODE_MS).toISOString() };
}
