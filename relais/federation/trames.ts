// Responsabilité : faire tenir un message du protocole fédéré dans une trame (TAILLE_MAX_CLAIR_OCTETS). Fonctions
// pures, sans E/S : on réduit la liste (les plus anciens d'abord) jusqu'à ce que le message passe.
import { type MessageChiffre, TAILLE_MAX_CLAIR_OCTETS } from '../../commun/federation.ts';

/** Le plus long préfixe de `liste` qui tient dans une trame une fois mis dans `construire` (vide si aucun). */
export function lePlusLongQuiTient<T>(
  liste: readonly T[],
  construire: (liste: readonly T[]) => MessageChiffre,
): readonly T[] {
  let courante = liste;
  while (courante.length > 0 && taille(construire(courante)) > TAILLE_MAX_CLAIR_OCTETS) {
    courante = courante.slice(0, courante.length - Math.max(1, Math.ceil(courante.length / 10)));
  }
  return courante;
}

/** Réduit une liste jusqu'à ce que le message construit tienne dans la limite d'une trame. */
export function tenirDansLaLimite<T>(
  liste: readonly T[],
  construire: (liste: readonly T[]) => MessageChiffre,
): MessageChiffre {
  return construire(lePlusLongQuiTient(liste, construire));
}

function taille(message: MessageChiffre): number {
  return new TextEncoder().encode(JSON.stringify(message)).byteLength;
}
