// Responsabilité : le propriétaire d'un invité en duo — un identifiant neuf, dérivé du nom saisi par Chris et d'un
// tirage aléatoire. Il suit les règles des propriétaires : minuscules, chiffres, tirets, 40 caractères au plus.
import { randomBytes } from 'node:crypto';

const LONGUEUR_BASE = 24;

export function proprietaireInvite(nom: string): string {
  const base = nom
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .slice(0, LONGUEUR_BASE)
    .replace(/^-+|-+$/g, '');
  return `${base || 'invite'}-${randomBytes(3).toString('hex')}`;
}
