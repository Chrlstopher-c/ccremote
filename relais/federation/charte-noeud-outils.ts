// Responsabilité : outils de la charte côté nœud — identifiant de réseau neuf, message `charte` sur le lien, dates,
// membre sans droits pour la reprise. Fonctions pures, sans état.
import type { CharteSignee, MembreSansDroits } from '../../commun/charte.ts';
import type { MessageChiffre } from '../../commun/federation.ts';
import type { PairFederee } from './secrets.ts';

export function reseauNeuf(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(6)), (o) => o.toString(16).padStart(2, '0')).join('');
}

export function messageDe(signee: CharteSignee): MessageChiffre {
  return { t: 'charte', texte: signee.texte, signature: signee.signature };
}

export function sansDroits(p: PairFederee): MembreSansDroits {
  return { id: p.id, nom: p.nom, identite: p.identite };
}

export function maintenant(): string {
  return new Date().toISOString();
}
