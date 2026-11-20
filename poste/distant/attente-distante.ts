// Responsabilité : les demandes qui attendent Chris dans une session claude.ai — permission d'un outil, question à
// choix (AskUserQuestion), plan (ExitPlanMode). Une file : la première est affichée. Pur : la décision à rendre à
// claude.ai est calculée ici, l'envoi est fait par la session.
import type { PermissionResult, PermissionUpdate } from '@anthropic-ai/claude-agent-sdk';
import type { Dialogue, ReponseDialogue } from '../../commun/session.ts';
import { dialoguePermission } from '../session/permissions-sdk.ts';
import {
  type Question,
  QUESTION_PLAN,
  OUTIL_PLAN,
  OUTIL_QUESTIONS,
  dialogueDeQuestion,
  decisionPlan,
  questionsDeAskUser,
  valeurReponse,
} from '../session/questions-sdk.ts';
import type { DemandeEntrante } from './controle-distant.ts';

const OPTIONS_PERMISSION = ['autoriser', 'toujours', 'refuser'] as const;
const TEXTE_REFUS = 'Refusé depuis Lanterne';
const TITRE_PLAN = 'Valider le plan proposé par Claude ?';

export type Decision = (typeof OPTIONS_PERMISSION)[number];

export interface DemandeEnAttente {
  readonly requestId: string;
  readonly outil: string;
  readonly entree: Record<string, unknown>;
  readonly suggestions: readonly PermissionUpdate[];
  readonly mode: 'permission' | 'question' | 'plan';
  readonly restantes: readonly Question[]; // questions pas encore répondues (la première est affichée)
  readonly reponses: Readonly<Record<string, string>>; // réponses déjà données, par texte de question
  readonly numero: number; // rang de la question affichée dans la demande
}

/** La résolution d'une réponse : à envoyer à claude.ai si `resultat` n'est pas null (sinon il reste des questions). */
export interface Resolution {
  readonly demande: DemandeEnAttente;
  readonly dialogue: Dialogue;
  readonly valeurs: readonly string[];
  readonly decision: Decision | null;
  readonly resultat: PermissionResult | null;
}

export function nouvelleDemande(d: DemandeEntrante): DemandeEnAttente {
  const base = { requestId: d.requestId, outil: d.outil, entree: d.entree, suggestions: d.suggestions };
  const vide = { reponses: {}, numero: 0 };
  if (d.outil === OUTIL_PLAN) return { ...base, ...vide, mode: 'plan', restantes: [QUESTION_PLAN] };
  const questions = d.outil === OUTIL_QUESTIONS ? questionsDeAskUser(d.entree) : null;
  if (questions) return { ...base, ...vide, mode: 'question', restantes: questions };
  return { ...base, ...vide, mode: 'permission', restantes: [] };
}

export const idDialogue = (d: DemandeEnAttente): string => `${d.requestId}:${d.numero}`;

export function dialogueDe(d: DemandeEnAttente): Dialogue | null {
  if (d.mode === 'plan') return dialogueDeQuestion(idDialogue(d), QUESTION_PLAN);
  if (d.mode === 'permission') return dialoguePermission(idDialogue(d), d.outil, d.entree, d.suggestions);
  const courante = d.restantes[0];
  return courante ? dialogueDeQuestion(idDialogue(d), courante) : null;
}

export function titreDe(d: DemandeEnAttente): string {
  if (d.mode === 'plan') return TITRE_PLAN;
  if (d.mode === 'permission') return `Autoriser ${d.outil} ?`;
  return d.restantes[0]?.texte ?? d.outil;
}

export class AttenteDistante {
  private file: DemandeEnAttente[] = [];

  /** Ajoute une demande à la file ; rend la demande si elle est nouvelle, null si elle est déjà connue. */
  ajouter(d: DemandeEntrante): DemandeEnAttente | null {
    if (this.file.some((a) => a.requestId === d.requestId)) return null;
    const demande = nouvelleDemande(d);
    this.file.push(demande);
    return demande;
  }

  /** Retire une demande close (répondue ailleurs, annulée) ; vrai si elle était là. */
  fermer(requestId: string): boolean {
    const avant = this.file.length;
    this.file = this.file.filter((a) => a.requestId !== requestId);
    return this.file.length !== avant;
  }

  courante(): DemandeEnAttente | null {
    return this.file[0] ?? null;
  }

  dialogue(): Dialogue | null {
    const d = this.courante();
    return d ? dialogueDe(d) : null;
  }

  /** La réponse de Chris à la demande affichée : une erreur, ou la résolution (décision ou question suivante). */
  repondre(r: ReponseDialogue): Resolution | string {
    const d = this.courante();
    const dialogue = d ? dialogueDe(d) : null;
    if (!d || !dialogue) return 'aucune demande en attente';
    if (r.id !== idDialogue(d)) return 'demande périmée : une autre demande est affichée';
    if (d.mode === 'permission') return this.decisionPermission(d, dialogue, r.index);
    if (d.mode === 'plan') return this.decisionDuPlan(d, dialogue, r);
    return this.reponseQuestion(d, dialogue, r);
  }

  private decisionPermission(d: DemandeEnAttente, dialogue: Dialogue, index: number | undefined): Resolution | string {
    const decision = OPTIONS_PERMISSION[index ?? -1];
    if (!decision) return 'réponse hors des options proposées';
    const resultat: PermissionResult = { behavior: 'allow', updatedInput: d.entree };
    if (decision === 'refuser')
      return { demande: d, dialogue, valeurs: [], decision, resultat: { behavior: 'deny', message: TEXTE_REFUS } };
    if (decision === 'toujours' && d.suggestions.length > 0) {
      return {
        demande: d,
        dialogue,
        valeurs: [],
        decision,
        resultat: { ...resultat, updatedPermissions: [...d.suggestions] },
      };
    }
    return { demande: d, dialogue, valeurs: [], decision, resultat };
  }

  private decisionDuPlan(d: DemandeEnAttente, dialogue: Dialogue, r: ReponseDialogue): Resolution | string {
    const resultat = decisionPlan(d.entree, r);
    if (!resultat) return 'réponse hors du plan proposé';
    return { demande: d, dialogue, valeurs: [], decision: r.index === 0 ? 'autoriser' : 'refuser', resultat };
  }

  // Une question après l'autre : les réponses s'accumulent, la demande part quand la dernière est répondue.
  private reponseQuestion(d: DemandeEnAttente, dialogue: Dialogue, r: ReponseDialogue): Resolution | string {
    const courante = d.restantes[0];
    if (!courante) return 'aucune question en attente';
    const valeur = valeurReponse(courante, r);
    if ('erreur' in valeur) return valeur.erreur;
    const reponses = { ...d.reponses, [courante.texte]: valeur.valeur };
    const reste = d.restantes.slice(1);
    if (reste.length > 0) {
      this.file = this.file.map((a) => (a === d ? { ...d, restantes: reste, reponses, numero: d.numero + 1 } : a));
      return { demande: d, dialogue, valeurs: valeur.valeurs, decision: null, resultat: null };
    }
    const resultat: PermissionResult = { behavior: 'allow', updatedInput: { ...d.entree, answers: reponses } };
    return { demande: d, dialogue, valeurs: valeur.valeurs, decision: null, resultat };
  }
}
