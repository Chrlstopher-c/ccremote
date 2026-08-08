/**
 * Responsabilité : le bandeau d'avertissement « chiffres factices ». Premier élément du
 * `<body>` dès que `factice === true` — aucun moyen de le masquer ou de le sauter.
 */

import type { FichierMesures } from '../../experience/contrat.ts';
import { echapper } from '../utils.ts';

export function rendreBandeau(m: FichierMesures): string {
  if (!m.factice) return '';
  const raison = m.raisonFactice ?? 'raison non renseignée dans le fichier de mesures';
  return `<div class="bandeau-factice"><div class="bandeau-factice-interieur">
    <p class="bandeau-factice-titre">CHIFFRES FACTICES — CE N'EST PAS UNE MESURE</p>
    <p class="bandeau-factice-raison">${echapper(raison)}</p>
  </div></div>`;
}
