/**
 * Responsabilité : gabarits de prompts pour le modèle local (SPEC §3, §5.3) — courts,
 * dimensionnés pour un 8B (Qwen3 8B AWQ), sortie attendue en JSON court. Aucun raisonnement
 * long n'est demandé : des listes de 0 à 3 éléments, chacun en une phrase.
 *
 * Conception inspirée de Hermes Agent (Nous Research) — MIT. Transposition indépendante en TypeScript.
 */

import type { Lecon, ResumeMission } from '../types.ts';

/**
 * Liste négative reprise verbatim de SPEC §5.3 — les cinq interdits, motivés par des dégâts
 * réels chez Hermes. Le prompt l'énonce ; `extraction-lecons.ts` (E5, hors périmètre de ce
 * mandat) la fait aussi respecter par un filtre déterministe après coup.
 */
export const LISTE_NEGATIVE_LECONS: readonly string[] = [
  "pas de panne d'environnement (binaire absent, service éteint, identifiants non configurés) ;",
  "pas d'affirmation négative sur un outil (« Playwright ne marche pas ») — c'est le motif qui se durcit en refus permanent ; si un outil a échoué par défaut de configuration, la leçon est le correctif, jamais l'incapacité ;",
  'pas d’erreur transitoire résolue dans la même mission (la leçon serait le retry, pas la panne) ;',
  'pas de narration de tâche unique (« corriger le bug X du 8 août ») ;',
  'pas de leçon qui nomme une mission, une date ou un identifiant de branche — si l’énoncé n’a de sens que pour cette mission-là, elle est rejetée.',
] as const;

const MAX_LECONS_CONTEXTE = 5;
const MAX_ERREURS_CONTEXTE = 5;
const MAX_FICHIERS_CONTEXTE = 10;

function ligneOuVide(valeurs: readonly string[], vide: string): string {
  return valeurs.length > 0 ? valeurs.join(' | ') : vide;
}

/**
 * Construit le prompt d'extraction de leçons (C-3) à partir d'un `ResumeMission` (jamais du
 * transcript brut) et des leçons déjà `active` du projet. Entrée bornée ≤ 3 000 tokens
 * (SPEC §3) : `ResumeMission` est lui-même borné sous 2 000 tokens (C-1), et le contexte de
 * leçons est plafonné à `MAX_LECONS_CONTEXTE` énoncés courts.
 */
export function construirePromptExtraction(resume: ResumeMission, leconsActives: readonly Lecon[]): string {
  const contexteLecons = leconsActives
    .slice(0, MAX_LECONS_CONTEXTE)
    .map((l) => `- (${l.id}) ${l.enonce}`)
    .join('\n');
  const interdits = LISTE_NEGATIVE_LECONS.map((item, index) => `${index + 1}. ${item}`).join('\n');

  return [
    "Tu analyses le résumé d'une mission d'équipe terminée. Ta seule tâche : proposer 0 à 3",
    "leçons candidates, réutilisables par de FUTURES équipes sur ce même projet.",
    '',
    'Interdits (rejette toi-même toute leçon qui en relève, avant de répondre) :',
    interdits,
    '',
    'Leçons déjà actives sur ce projet — ne les reformule pas, cite `doublonDe` si tu en retrouves une :',
    contexteLecons.length > 0 ? contexteLecons : '(aucune)',
    '',
    `Résumé de mission — issue : ${resume.issue}, ${resume.nbTours} tours, ${resume.dureeMs} ms.`,
    `Mandat : ${resume.mandatResume}`,
    `Erreurs : ${ligneOuVide(resume.erreurs.slice(0, MAX_ERREURS_CONTEXTE), '(aucune)')}`,
    `Fichiers touchés : ${ligneOuVide(resume.fichiersTouches.slice(0, MAX_FICHIERS_CONTEXTE), '(aucun)')}`,
    `Extrait final : ${resume.extraitFinal}`,
    '',
    'Réponds UNIQUEMENT avec un tableau JSON de 0 à 3 objets, chacun de forme EXACTE :',
    '{"enonce": "…" (≤200 car.), "categorie": "outil"|"projet"|"methode"|"piege",',
    ' "portee": "projet"|"machine"|"global", "preuve": "…" (≤200 car.), "doublonDe": "id"|null}',
    'Aucun texte hors de ce tableau JSON — ni prose, ni explication, ni balise de code.',
  ].join('\n');
}
