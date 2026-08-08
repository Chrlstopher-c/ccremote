/**
 * Responsabilité : l'en-tête de la page — titre, thèse éditoriale, ligne de provenance
 * (modèle, nombre d'exécutions, date de génération), toutes deux dernières tirées du
 * fichier de mesures.
 */

import type { FichierMesures } from '../../experience/contrat.ts';
import { echapper } from '../utils.ts';

export function rendreEntete(m: FichierMesures): string {
  return `<header class="section">
  <div class="bloc-prose">
    <h1>Est-ce que le harness a appris ?</h1>
    <p class="these">Une leçon injectée dans le mandat d'une équipe change-t-elle ce qu'elle fait,
    mesurablement, sur le même piège ?</p>
    <p class="provenance">modèle : ${echapper(m.protocole.modele)} · exécutions : ${m.executions.length} ·
    générée le ${echapper(m.genereA)}</p>
  </div>
</header>`;
}
