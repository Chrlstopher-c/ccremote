/**
 * Responsabilité : libellés de durée pour l'affichage, partagés par les vues de
 * l'API web.
 *
 * Mutualisé (et non dupliqué) parce que c'est une seule et même règle métier
 * d'affichage : « depuis combien de temps », lue de la même façon partout dans
 * l'interface. Deux formulations divergentes feraient douter l'opérateur de ce
 * qu'il lit — exactement ce qu'une file d'attente et une liste de missions
 * côte à côte rendraient visible.
 */

const MINUTE_MS = 60_000;

/** `null` si l'instant de référence est inconnu — jamais « 0 min », qui serait faux. */
export function ageLisible(depuisMs: number | null, maintenantMs: number): string | null {
  if (depuisMs === null) return null;
  const ecoule = Math.max(0, maintenantMs - depuisMs);
  const minutes = Math.floor(ecoule / MINUTE_MS);
  if (minutes < 1) return "à l'instant";
  if (minutes < 60) return `${minutes} min`;
  const heures = Math.floor(minutes / 60);
  if (heures < 24) return `${heures} h`;
  return `${Math.floor(heures / 24)} j`;
}
