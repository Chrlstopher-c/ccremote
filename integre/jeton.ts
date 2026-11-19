// Responsabilité : inscrire en base le jeton que l'appli Lanterne a tiré, avant que le relais ne démarre.
import type { Logger } from 'pino';
import { enregistrerJetonFixe } from '../relais/acces/acces.ts';
import { ouvrirBase } from '../relais/registre/base.ts';
import { Registre } from '../relais/registre/registre.ts';

export const APPAREIL_INTEGRE = 'lanterne-integre';

export function enregistrerJeton(chemin: string, jeton: string, journal: Logger): void {
  const base = ouvrirBase(chemin);
  try {
    enregistrerJetonFixe(new Registre(base, journal), jeton, APPAREIL_INTEGRE);
  } finally {
    base.close();
  }
}
