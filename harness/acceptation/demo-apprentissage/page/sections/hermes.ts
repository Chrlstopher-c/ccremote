/**
 * Responsabilité : « Ce qu'on a repris de Hermes » — prose éditoriale fixe, pas des
 * mesures. Trois écarts entre l'apprentissage d'un agent et celui du harness.
 */

import { section } from '../utils.ts';

interface Ecart {
  readonly axe: string;
  readonly agent: string;
  readonly harness: string;
}

const ECARTS: readonly Ecart[] = [
  {
    axe: 'Qui apprend',
    agent: 'un agent, sur la durée',
    harness: "le harness, dont les équipes sont éphémères",
  },
  {
    axe: 'Ce qu\'on observe',
    agent: 'la liste de messages du tour courant',
    harness: 'un transcript JSONL complet, après coup',
  },
  {
    axe: 'Quand ça se déclenche',
    agent: 'tous les 10 tours, pendant',
    harness: "à la clôture d'une mission",
  },
];

function ligne(ecart: Ecart): string {
  return `<tr><td>${ecart.axe}</td><td>${ecart.agent}</td><td>${ecart.harness}</td></tr>`;
}

export function rendreHermes(): string {
  const lignes = ECARTS.map(ligne).join('\n');
  const contenu = `<p>Hermes est le mécanisme d'apprentissage inline d'un agent conversationnel : il relit
    son propre tour et ajuste. Le harness relit le passé d'une équipe entière, pas un tour — trois écarts
    en découlent.</p>
    <table>
      <thead><tr><th>Axe</th><th>Chez un agent (Hermes)</th><th>Dans le harness</th></tr></thead>
      <tbody>${lignes}</tbody>
    </table>`;
  return section('02', "Ce qu'on a repris de Hermes", contenu);
}
