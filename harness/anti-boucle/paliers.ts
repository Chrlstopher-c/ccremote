/**
 * Responsabilité : décider si le coût courant d'une mission franchit un NOUVEAU palier
 * de déclenchement (H-68). Pur, aucune I/O.
 *
 * ☠ Un palier est un déclencheur d'inspection, jamais une limite : ce module ne dit
 * jamais « couper », seulement « inspecter maintenant ». La décision de couper vit
 * exclusivement dans `decision-coupure.ts`, après verdict du juge.
 */

import type { ConfigPaliers, DeclenchementPalier, EtatPaliers } from './types.ts';

/**
 * Palier le plus haut STRICTEMENT franchi et pas encore inspecté. Si plusieurs paliers
 * ont été franchis d'un coup (mission rapide entre deux vérifications), on ne rend que
 * le plus haut — mais `nouvelEtat` marque TOUS les paliers jusque-là comme inspectés,
 * pour ne jamais redéclencher rétroactivement sur les paliers sautés.
 */
export function verifierPalier(
  coutCourantUsd: number,
  config: ConfigPaliers,
  etat: EtatPaliers,
): DeclenchementPalier {
  const seuils = [...config.seuilsUsd].sort((a, b) => a - b);
  let indexFranchi = -1;

  for (let i = 0; i < seuils.length; i += 1) {
    const seuil = seuils[i];
    if (seuil !== undefined && seuil <= coutCourantUsd && i > etat.dernierPalierInspecteIndex) {
      indexFranchi = i;
    }
  }

  if (indexFranchi === -1) {
    return { declenche: false, palierUsd: null, indexPalier: null, nouvelEtat: etat };
  }

  const palierUsd = seuils[indexFranchi];
  return {
    declenche: true,
    palierUsd: palierUsd ?? null,
    indexPalier: indexFranchi,
    nouvelEtat: { dernierPalierInspecteIndex: indexFranchi },
  };
}

/** `true` si tous les paliers configurés ont déjà été inspectés (utile pour l'observabilité). */
export function tousPaliersInspectes(config: ConfigPaliers, etat: EtatPaliers): boolean {
  return etat.dernierPalierInspecteIndex >= config.seuilsUsd.length - 1;
}
