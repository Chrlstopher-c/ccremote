// Outil de preuve de reproductibilité. Un injecteur n'est utilisable que si
// deux exécutions du même scénario produisent exactement la même trace de faits.
// Réservé aux tests : rien du code de production ne doit importer ce module.

import type { Fait } from './journal/faits.ts';

/** Sérialisation stable d'une trace : instant simulé, type, détails. */
export function empreinte(faits: readonly Fait[]): string {
  return faits.map((f) => `${f.a}|${f.type}|${JSON.stringify(f.details)}`).join('\n');
}

export interface DeuxExecutions {
  readonly premiere: string;
  readonly seconde: string;
}

/**
 * Rejoue `scenario` deux fois à partir d'un état neuf et rend les deux
 * empreintes. Le test compare : toute divergence dénonce un injecteur
 * dépendant du temps réel, de l'ordre d'itération ou d'un état résiduel.
 */
export async function rejouerDeuxFois(
  scenario: () => Promise<readonly Fait[]> | readonly Fait[],
): Promise<DeuxExecutions> {
  const premiere = empreinte(await scenario());
  const seconde = empreinte(await scenario());
  return { premiere, seconde };
}
