/**
 * Responsabilité : « Les mesures » — assemble les trois graphiques et les deux tableaux
 * de la section. N'extrait ni ne calcule rien lui-même : délègue à chaque sous-module.
 */

import type { FichierMesures } from '../../experience/contrat.ts';
import { section } from '../utils.ts';
import { dessinerGraphiqueTentatives } from './mesures-tentatives.ts';
import { dessinerGraphiquePremierCoup } from './mesures-premier-coup.ts';
import { dessinerGraphiqueCoutDuree } from './mesures-cout-duree.ts';
import { rendreTableaux } from './mesures-tableaux.ts';

export function rendreMesures(m: FichierMesures): string {
  const contenu = `${dessinerGraphiqueTentatives(m.executions)}
    ${dessinerGraphiquePremierCoup(m.agregats)}
    ${dessinerGraphiqueCoutDuree(m.agregats)}
    ${rendreTableaux(m.executions, m.agregats)}`;
  return section('06', 'Les mesures', contenu, true);
}
