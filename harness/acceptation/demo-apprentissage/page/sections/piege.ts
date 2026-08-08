/**
 * Responsabilité : « Le piège » — rend `protocole.piege` et `protocole.tache` telles
 * qu'écrites dans le fichier de mesures, échappées, jamais reformulées.
 */

import type { FichierMesures } from '../../experience/contrat.ts';
import { echapper, section } from '../utils.ts';

export function rendrePiege(m: FichierMesures): string {
  const contenu = `<p><strong>Le piège.</strong> ${echapper(m.protocole.piege)}</p>
    <p><strong>La tâche.</strong> ${echapper(m.protocole.tache)}</p>`;
  return section('04', 'Le piège', contenu);
}
