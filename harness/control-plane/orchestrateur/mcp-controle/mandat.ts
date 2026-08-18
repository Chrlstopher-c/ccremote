/**
 * Responsabilité : composer la proposition de mandat d'équipe (A.3.1, H-52, H-66).
 * Pur — aucune I/O, aucun effet de bord. Utilisé exclusivement par `creer_equipe`
 * (H-61) : cette fonction ne crée rien, elle ne fait que rédiger ce que l'UI
 * présentera à l'approbation humaine.
 */

import type { AccesMandat } from '../../../shared/acces-mandat.ts';
import { plafondEffectifUsd } from '../../../shared/budget-equipe.ts';

export interface PropositionMandat {
  readonly projet: string;
  readonly objectif: string;
  readonly critereArret: string | null;
  readonly perimetre: string;
  readonly acces: AccesMandat;
  readonly texte: string;
}

const CLAUSES_FIXES = [
  // H-52 — rôle et obligation de validation réelle, pas seulement de lecture.
  'Tu es le team leader de cette équipe : responsable de A à Z (développement, tests, ' +
    'debug, tests end-to-end AVANT de déclarer terminé). Utilise les MCP à disposition ' +
    '(Playwright, Log Watcher, pty-mcp…) pour valider réellement — lire du code ne suffit pas.',
  // `☠` Ce que « validé » veut dire, en termes vérifiables. Sans ces trois
  // gestes, un lead rend « c'est corrigé » sur un correctif qui ne s'applique
  // jamais — le mode de panne le plus cher mesuré sur ce dépôt (31/07, trois
  // occurrences en une session, toutes vertes sur le papier).
  'Un correctif VERT peut cacher une panne intacte. Avant de déclarer quoi que ce soit ' +
    'corrigé : (1) valide ton test dans les DEUX SENS — annule ton correctif, vois le test ' +
    'échouer, restaure ; un test qui ne sait pas échouer ne prouve rien ; (2) lis un ' +
    'artefact RÉEL avant et après (une ligne en base, une ligne de log), jamais seulement ' +
    'un test ; (3) quand tu remplaces une constante par un calcul, la question n’est pas ' +
    '« le calcul est-il juste ? » mais « ce qu’il lit est-il jamais écrit ? ».',
  // `☠` Le lead ignorait qu'il est observé et qu'on peut lui parler. Il pouvait
  // donc lire un message de mi-parcours comme une interruption, y répondre par
  // une synthèse, et s'arrêter — alors que rien ne lui demandait de finir.
  'L’orchestrateur te suit en direct et peut t’envoyer un message en cours de route. ' +
    'Un message reçu pendant ton travail est une correction de cap, jamais un ordre de ' +
    't’arrêter : intègre-le et poursuis.',
  // H-66 — attribution de l'émetteur : jamais laisser le lead déduire qui lui parle.
  "Tu es une équipe parmi d'autres, parfois en parallèle, toutes dirigées par le même " +
    "orchestrateur maître. Tes instructions viennent normalement de l'orchestrateur, pas de " +
    "l'humain. L'opérateur peut aussi te parler directement — ces messages-là sont identifiés " +
    'comme tels : ne jamais attribuer à l\'opérateur une instruction venue de l\'orchestrateur.',
] as const;

// `☠` LA CLAUSE D'ATTENTE N'EST PAS ICI, ET C'EST DÉLIBÉRÉ (03/08). Ces
// CLAUSES_FIXES composent le texte de la CARTE D'AUTORISATION — ce que Chris lit
// avant de cliquer. Le systemPrompt réellement posé sur le worker est composé
// ailleurs (`dispatch-mandat.ts`, `composerMandatSysteme`). Écrire la règle ici
// l'aurait rendue invisible au lead tout en la faisant paraître livrée : le
// défaut du 01/08, à l'identique. C'est un test d'assemblage partant du chemin
// réellement emprunté qui l'a rattrapé avant le déploiement.

/**
 * Construit le texte du mandat à soumettre à l'approbation (H-61). N'écrit rien, ne
 * dispatche rien : le seul effet est de rendre une chaîne de caractères.
 */
/** Ce que l'opérateur lit avant de cliquer — jamais un code, toujours l'effet réel. */
function libelleAcces(acces: AccesMandat): string {
  return acces === 'lecture'
    ? 'LECTURE SEULE (Write, Edit et NotebookEdit refusés ; Bash reste ouvert pour explorer)'
    : 'lecture et écriture';
}

/**
 * `☠` Le budget est ANNONCÉ au lead, pas seulement appliqué (mandat opérateur,
 * 18/08) : une équipe de diagnostic a bâti son hypothèse principale sur un
 * supposé dépassement de budget alors qu'elle était à 15 % de son plafond —
 * rien ne le lui disait. `plafondEffectifUsd` (même calcul que `dispatch-mandat.ts`,
 * une seule source pour ne jamais diverger) : le montant réel, propre à la
 * mission ou dérivé du plafond de parc si aucun n'a été fixé.
 */
function ligneBudget(budgetMaxUsd: number | null): string {
  const montant = plafondEffectifUsd(budgetMaxUsd);
  const origine =
    budgetMaxUsd !== null && budgetMaxUsd > 0
      ? 'plafond propre à cette mission'
      : 'aucun plafond propre n’a été fixé pour cette mission — tu cours sous le plafond de parc';
  return (
    `Budget : ${montant.toFixed(2)} $ (${origine}). Au-delà, ta session est coupée net, où que ` +
    'tu en sois, et le travail non commité serait perdu.'
  );
}

export function construireMandatPropose(
  projet: string,
  objectif: string,
  critereArret: string | null,
  perimetre: string,
  acces: AccesMandat,
  budgetMaxUsd: number | null,
): PropositionMandat {
  const lignes = [
    `Objectif : ${objectif}`,
    `Périmètre autorisé : ${perimetre} (interdiction de sortir du worktree)`,
    // `☠` L'accès figure dans le TEXTE soumis à l'opérateur : H-61 veut une
    // autorisation éclairée, et « lecture seule » ou « écriture » est ce qui
    // change le plus la portée de ce qu'il approuve d'un clic.
    `Accès accordé : ${libelleAcces(acces)}`,
    `Critère d'arrêt : ${critereArret ?? '⚠ non fourni — à compléter avant approbation'}`,
    ligneBudget(budgetMaxUsd),
    // `☠` L'outil existe depuis le 18/08 (`ccremote-depense`/`ma_depense`) mais
    // restait invisible à ce texte-ci : un lead qui ignore qu'il l'a ne l'appelle
    // jamais. Même incident que la ligne budget — le dire ici, pas seulement le câbler.
    'Outil de consultation : `ma_depense` te donne ta dépense en dollars, ton plafond et la part ' +
      "déjà consommée. Appelle-le avant d'engager un travail long, dès que tu hésites à " +
      'approfondir une piste, ou avant de lancer une exploration coûteuse.',
    ...CLAUSES_FIXES,
  ];
  return { projet, objectif, critereArret, perimetre, acces, texte: lignes.join('\n\n') };
}
