/**
 * Responsabilité : le pied de page — chemin du fichier de mesures effectivement lu,
 * version du contrat, date de génération. Le chemin n'est pas dans `FichierMesures` :
 * il vient du point d'entrée, seul à connaître l'argument CLI.
 */

import type { FichierMesures } from '../../experience/contrat.ts';
import { echapper } from '../utils.ts';

export function rendrePied(m: FichierMesures, cheminMesures: string): string {
  return `<footer>
    <p>fichier de mesures : ${echapper(cheminMesures)} · version ${m.version} · généré le ${echapper(m.genereA)}</p>
    <p>Chaque chiffre de cette page vient de ce fichier ; le générateur n'en écrit aucun.</p>
  </footer>`;
}
