// Responsabilité : les identifiants aléatoires de la fédération — canaux (un par ouverture) et références de requête.
import { randomBytes } from 'node:crypto';

/** Identifiant de canal : 16 caractères hexadécimaux, sûrs pour l'aiguilleur (`[A-Za-z0-9_-]{1,64}`). */
export function nonceCanal(): string {
  return randomBytes(8).toString('hex');
}

/** Référence d'une requête (corrélation de la réponse) : 16 caractères hexadécimaux. */
export function nonceRef(): string {
  return randomBytes(8).toString('hex');
}
