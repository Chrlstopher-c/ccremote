// Responsabilité : la preuve de connaissance de la clé de paire (HMAC d'un défi). La clé ne circule jamais en clair.
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export type RoleLien = 'serveur' | 'client';

export function nonce(): string {
  return randomBytes(16).toString('hex');
}

export function cleNeuve(): string {
  return randomBytes(32).toString('hex');
}

export function preuve(cle: string, role: RoleLien, nonceDefi: string, paire: string): string {
  return createHmac('sha256', Buffer.from(cle, 'hex')).update(`${role}|${nonceDefi}|${paire}`).digest('hex');
}

export function preuveValide(attendue: string, recue: string): boolean {
  const a = Buffer.from(attendue, 'hex');
  const b = Buffer.from(recue, 'hex');
  return a.length > 0 && a.length === b.length && timingSafeEqual(a, b);
}
