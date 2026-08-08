/**
 * Responsabilité : « Ce que ça ne prouve pas » — la liste `protocole.limites`
 * intégralement, une puce par entrée, aussi visible que les autres sections.
 */

import type { FichierMesures } from '../../experience/contrat.ts';
import { echapper, section } from '../utils.ts';

export function rendreLimites(m: FichierMesures): string {
  const puces = m.protocole.limites.map((limite) => `<li>${echapper(limite)}</li>`).join('\n');
  const contenu = `<ul class="liste-limites">${puces}</ul>`;
  return section('10', 'Ce que ça ne prouve pas', contenu);
}
