/**
 * Responsabilité : les deux tableaux de la section « Les mesures » — une ligne par
 * exécution, puis les agrégats par condition. Toutes les cellules viennent du fichier
 * de mesures ; une valeur `null` s'affiche comme « non mesuré », jamais un repli chiffré.
 */

import type { AgregatCondition, Execution } from '../../experience/contrat.ts';
import {
  echapper,
  nombreOuNonMesure,
  ouiNon,
  pastilleCondition,
  secondesDepuisMs,
  usdOuNonMesure,
} from '../utils.ts';

function ligneExecution(execution: Execution): string {
  return `<tr>
    <td>${pastilleCondition(execution.condition)}${echapper(execution.condition)}</td>
    <td>${execution.repetition}</td>
    <td>${nombreOuNonMesure(execution.tentativesAvantSucces)}</td>
    <td>${ouiNon(execution.reussiDuPremierCoup)}</td>
    <td>${ouiNon(execution.succesVerifie)}</td>
    <td>${execution.nbTours}</td>
    <td>${execution.appelsOutilsTotal}</td>
    <td>${secondesDepuisMs(execution.dureeMs)}</td>
    <td>${usdOuNonMesure(execution.coutUsd)}</td>
  </tr>`;
}

function tableauExecutions(executions: readonly Execution[]): string {
  const lignes = executions.map(ligneExecution).join('\n');
  return `<table>
    <thead><tr>
      <th>Condition</th><th>Répétition</th><th>Tentatives</th><th>Premier coup</th>
      <th>Succès vérifié</th><th>Tours</th><th>Appels outils</th><th>Durée</th><th>Coût</th>
    </tr></thead>
    <tbody>${lignes}</tbody>
  </table>`;
}

function ligneAgregat(agregat: AgregatCondition): string {
  return `<tr>
    <td>${pastilleCondition(agregat.condition)}${echapper(agregat.condition)}</td>
    <td>${agregat.executions}</td>
    <td>${agregat.succesVerifie}</td>
    <td>${agregat.reussiDuPremierCoup}</td>
    <td>${nombreOuNonMesure(agregat.tentativesMediane, 1)}</td>
    <td>${nombreOuNonMesure(agregat.tentativesMoyenne, 2)}</td>
    <td>${secondesDepuisMs(agregat.dureeMedianeMs)}</td>
    <td>${usdOuNonMesure(agregat.coutMoyenUsd)}</td>
    <td>${agregat.appelsOutilsMoyens.toFixed(1)}</td>
  </tr>`;
}

function tableauAgregats(agregats: readonly AgregatCondition[]): string {
  const lignes = agregats.map(ligneAgregat).join('\n');
  return `<table>
    <thead><tr>
      <th>Condition</th><th>Exécutions</th><th>Succès vérifié</th><th>Premier coup</th>
      <th>Tentatives médiane</th><th>Tentatives moyenne</th><th>Durée médiane</th>
      <th>Coût moyen</th><th>Appels outils moyens</th>
    </tr></thead>
    <tbody>${lignes}</tbody>
  </table>`;
}

export function rendreTableaux(executions: readonly Execution[], agregats: readonly AgregatCondition[]): string {
  return `<h3 class="graphique-titre">Détail par exécution</h3>
    ${tableauExecutions(executions)}
    <h3 class="graphique-titre" style="margin-top:32px">Agrégats par condition</h3>
    ${tableauAgregats(agregats)}`;
}
