/**
 * Responsabilité : « Le sens inverse » — explique que `sans_lecon` EST la condition
 * « leçon retirée », exécutée en alternance avec les autres, puis affiche les deux
 * chiffres de premier coup tirés des agrégats.
 */

import type { AgregatCondition, Condition, FichierMesures } from '../../experience/contrat.ts';
import { echapper, section } from '../utils.ts';

function fractionPremierCoup(agregats: readonly AgregatCondition[], condition: Condition): string {
  const agregat = agregats.find((a) => a.condition === condition);
  if (agregat === undefined) return 'non mesuré';
  return `${agregat.reussiDuPremierCoup}/${agregat.executions}`;
}

export function rendreSensInverse(m: FichierMesures): string {
  const sansLecon = fractionPremierCoup(m.agregats, 'sans_lecon');
  const avecLecon = fractionPremierCoup(m.agregats, 'avec_lecon');
  const contenu = `<p>Il n'y a pas eu de groupe témoin séparé : <code>sans_lecon</code> EST la condition
    « leçon retirée ». Ses répétitions sont exécutées en ALTERNANCE avec celles des deux autres
    conditions — jamais toutes à la suite — pour qu'aucune dérive dans le temps (charge, version du
    modèle, autre) ne se confonde avec l'effet de la leçon elle-même.</p>
    <p>Premier coup en <code>sans_lecon</code> : <strong>${echapper(sansLecon)}</strong> ·
    premier coup en <code>avec_lecon</code> : <strong>${echapper(avecLecon)}</strong>.</p>`;
  return section('09', 'Le sens inverse', contenu);
}
