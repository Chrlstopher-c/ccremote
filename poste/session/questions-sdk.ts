// Responsabilité : les deux outils qui demandent l'avis de Chris (AskUserQuestion, ExitPlanMode) — leur entrée du SDK
// devient un dialogue du poste, et la réponse de Chris redevient la décision de permission attendue par le SDK.
// Pur, sans I/O.
import type { PermissionResult } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import type { Dialogue, ReponseDialogue } from '../../commun/session.ts';

export const OUTIL_QUESTIONS = 'AskUserQuestion';
export const OUTIL_PLAN = 'ExitPlanMode';
export const OUTILS_AVIS: ReadonlySet<string> = new Set([OUTIL_QUESTIONS, OUTIL_PLAN]);

const LIBELLE_SAISIE = 'Autre (réponse libre)';

export interface Question {
  readonly texte: string;
  readonly options: readonly { readonly libelle: string; readonly description: string }[];
  readonly multiple: boolean;
  readonly saisie: number | null; // index de l'option qui accepte une réponse libre
}

export type ValeurReponse = { readonly valeur: string } | { readonly erreur: string };

const SchemaQuestions = z.object({
  questions: z
    .array(
      z.object({
        question: z.string(),
        options: z.array(z.object({ label: z.string(), description: z.string().default('') })).min(1),
        multiSelect: z.boolean().default(false),
      }),
    )
    .min(1),
});

export const QUESTION_PLAN: Question = {
  texte: 'Valider le plan proposé par Claude ?',
  options: [
    { libelle: 'Approuver', description: 'Claude passe à l’exécution' },
    { libelle: 'Refuser', description: 'Rester en plan ; le texte saisi est transmis à Claude' },
  ],
  multiple: false,
  saisie: 1,
};

/** Les questions d'un AskUserQuestion, ou null si son entrée n'a pas la forme attendue. */
export function questionsDeAskUser(entree: Record<string, unknown>): Question[] | null {
  const lue = SchemaQuestions.safeParse(entree);
  if (!lue.success) return null;
  return lue.data.questions.map((q) => ({
    texte: q.question,
    options: [
      ...q.options.map((o) => ({ libelle: o.label, description: o.description })),
      { libelle: LIBELLE_SAISIE, description: 'Saisir une réponse' },
    ],
    multiple: q.multiSelect,
    saisie: q.options.length,
  }));
}

export function dialogueDeQuestion(id: string, q: Question): Dialogue {
  return {
    id,
    titre: q.texte,
    options: q.options.map((o) => ({ libelle: o.libelle, description: o.description })),
    multiple: q.multiple,
    saisie: q.saisie,
    coches: [],
  };
}

function valeurCases(q: Question, cases: readonly number[], texte: string): ValeurReponse {
  const choisies = [...new Set(cases)].filter((i) => i < q.options.length).sort((a, b) => a - b);
  if (choisies.includes(q.saisie ?? -1) && !texte) return { erreur: 'réponse libre attendue' };
  const valeurs = choisies.map((i) => (i === q.saisie ? texte : (q.options[i]?.libelle ?? '')));
  return valeurs.length > 0 ? { valeur: valeurs.join(', ') } : { erreur: 'aucune case cochée' };
}

/** La réponse de Chris à une question, sous forme de texte pour le SDK. */
export function valeurReponse(q: Question, r: ReponseDialogue): ValeurReponse {
  const texte = r.texte?.trim() ?? '';
  if (q.multiple) return valeurCases(q, r.cases ?? [], texte);
  if (r.index === undefined || r.index >= q.options.length) return { erreur: 'option hors de la question affichée' };
  if (r.index === q.saisie) return texte ? { valeur: texte } : { erreur: 'réponse libre attendue' };
  return { valeur: q.options[r.index]?.libelle ?? '' };
}

/** La décision à rendre au SDK pour ExitPlanMode : approuver (option 0) ou refuser, avec le texte éventuel. */
export function decisionPlan(entree: Record<string, unknown>, r: ReponseDialogue): PermissionResult | null {
  if (r.index === 0) return { behavior: 'allow', updatedInput: entree };
  if (r.index !== 1) return null;
  return { behavior: 'deny', message: r.texte?.trim() || 'Plan refusé par Chris' };
}
