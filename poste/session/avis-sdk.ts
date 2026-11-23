// Responsabilité : les demandes qui attendent Chris dans une session SDK — questions (AskUserQuestion), plan
// (ExitPlanMode) et permissions d'outil. Elle publie la courante comme dialogue du fil, et rend au SDK la décision de
// Chris. Une demande n'est jamais perdue : les suivantes attendent dans la file (voir file-avis-sdk.ts).
import { randomUUID } from 'node:crypto';
import type { PermissionResult, PermissionUpdate } from '@anthropic-ai/claude-agent-sdk';
import type { Evenement, ReponseDialogue, ResumeSession } from '../../commun/session.ts';
import { type AvisEnAttente, FileAvis, type Retrait } from './file-avis-sdk.ts';
import { decisionPermission, dialoguePermission } from './permissions-sdk.ts';
import {
  decisionPlan,
  dialogueDeQuestion,
  OUTIL_PLAN,
  OUTILS_AVIS,
  QUESTION_PLAN,
  questionsDeAskUser,
  type Question,
  valeurReponse,
} from './questions-sdk.ts';

export interface PublicationAvis {
  emettre(evt: Evenement): void;
  maj(champs: Partial<ResumeSession>): void;
}

// Options de la permission, dans l'ordre affiché : Autoriser, Toujours autoriser, Refuser (voir decisionPermission).
const DECISIONS_PERMISSION = ['autoriser', 'toujours', 'refuser'] as const;

function autoriserSansQuestion(entree: Record<string, unknown>): PermissionResult {
  return { behavior: 'allow', updatedInput: entree };
}

export const TEXTE_QUESTION_PASSEE =
  'L’utilisateur a passé la question sans répondre. Continue avec ton meilleur jugement, ou repose-la plus tard si elle bloque.';

export class AvisSdk {
  private readonly file = new FileAvis();

  constructor(private readonly publication: PublicationAvis) {}

  /** Réponse de Chris à la demande affichée. Un message d'erreur, ou null si elle est prise en compte. */
  repondre(r: ReponseDialogue): string | null {
    const a = this.file.courante;
    if (!a) return 'aucune question en attente';
    if (r.id !== a.id) return 'question périmée : une autre question est affichée';
    if (a.permission) return this.repondrePermission(a, r);
    if (a.outil === OUTIL_PLAN) return this.repondrePlan(a, r);
    return this.repondreQuestion(a, r);
  }

  // Appelé par le SDK avant un outil : questions et plan deviennent des dialogues ; une permission n'est demandée que
  // hors du mode bypass (défaut de Lanterne : tout outil autorisé d'office).
  autoriser(
    nom: string,
    entree: Record<string, unknown>,
    suggestions: readonly PermissionUpdate[],
    signal: AbortSignal,
    bypass: boolean,
  ): Promise<PermissionResult> {
    if (!OUTILS_AVIS.has(nom)) {
      if (bypass) return Promise.resolve(autoriserSansQuestion(entree));
      return this.attendre({ outil: nom, entree, restantes: [], suggestions, permission: true }, signal);
    }
    const restantes = nom === OUTIL_PLAN ? [QUESTION_PLAN] : questionsDeAskUser(entree);
    if (!restantes) {
      return Promise.resolve({ behavior: 'deny', message: 'Questions illisibles : réponse impossible' });
    }
    return this.attendre({ outil: nom, entree, restantes, suggestions: [], permission: false }, signal);
  }

  // Refus de toute la file (interruption, fermeture) : le SDK ne reste jamais sans réponse.
  refuserTous(message: string, interrompre: boolean): void {
    const retires = this.file.vider();
    for (const a of retires) a.decide({ behavior: 'deny', message, interrupt: interrompre });
    if (retires.length > 0) this.publication.maj({ dialogue: null, statut: 'travail' });
  }

  private repondreQuestion(a: AvisEnAttente, r: ReponseDialogue): string | null {
    const courante = a.restantes[0];
    if (!courante) return 'aucune question en attente';
    if (r.passer) return this.passerQuestions(a, courante);
    const valeur = valeurReponse(courante, r);
    if ('erreur' in valeur) return valeur.erreur;
    a.reponses[courante.texte] = valeur.valeur;
    this.publication.emettre({
      type: 'dialogue_resolu',
      dialogue: dialogueDeQuestion(a.id, courante),
      reponses: [...valeur.valeurs],
    });
    a.restantes.shift();
    if (a.restantes.length > 0) {
      this.publier(a);
      return null;
    }
    this.terminer(a, { behavior: 'allow', updatedInput: { ...a.entree, answers: a.reponses } });
    return null;
  }

  // Passer (comme Desktop) : Claude apprend que Chris n'a pas répondu et continue sans ces réponses.
  private passerQuestions(a: AvisEnAttente, courante: Question): null {
    this.publication.emettre({ type: 'dialogue_resolu', dialogue: dialogueDeQuestion(a.id, courante), reponses: [] });
    this.annuler(a, TEXTE_QUESTION_PASSEE);
    return null;
  }

  private repondrePlan(a: AvisEnAttente, r: ReponseDialogue): string | null {
    const decision = decisionPlan(a.entree, r);
    if (!decision) return 'réponse hors du plan proposé';
    this.publication.emettre({
      type: 'dialogue_resolu',
      dialogue: dialogueDeQuestion(a.id, QUESTION_PLAN),
      decision: r.index === 0 ? 'autoriser' : 'refuser',
    });
    this.terminer(a, decision);
    return null;
  }

  private repondrePermission(a: AvisEnAttente, r: ReponseDialogue): string | null {
    const decision = decisionPermission(a.entree, a.suggestions, r);
    if (!decision) return 'réponse hors des options proposées';
    this.publication.emettre({
      type: 'dialogue_resolu',
      dialogue: dialoguePermission(a.id, a.outil, a.entree, a.suggestions),
      decision: DECISIONS_PERMISSION[r.index ?? 2] ?? 'refuser',
    });
    this.terminer(a, decision);
    return null;
  }

  private attendre(
    p: Pick<AvisEnAttente, 'outil' | 'entree' | 'restantes' | 'suggestions' | 'permission'>,
    signal: AbortSignal,
  ): Promise<PermissionResult> {
    return new Promise<PermissionResult>((decide) => {
      const a: AvisEnAttente = { ...p, reponses: {}, id: '', decide };
      signal.addEventListener('abort', () => this.annuler(a, 'Demande annulée'), { once: true });
      if (this.file.ajouter(a)) this.publier(a);
    });
  }

  private publier(a: AvisEnAttente): void {
    a.id = randomUUID();
    if (a.permission) {
      this.publication.emettre({ type: 'question', question: `Autoriser ${a.outil} ?` });
      this.publication.maj({
        statut: 'question',
        dialogue: dialoguePermission(a.id, a.outil, a.entree, a.suggestions),
      });
      return;
    }
    const courante = a.restantes[0];
    if (!courante) return;
    this.publication.emettre({ type: 'question', question: courante.texte });
    this.publication.maj({ statut: 'question', dialogue: dialogueDeQuestion(a.id, courante) });
  }

  private terminer(a: AvisEnAttente, decision: PermissionResult): void {
    const retrait = this.file.retirer(a);
    if (!retrait) return;
    a.decide(decision);
    this.suivante(retrait);
  }

  private annuler(a: AvisEnAttente, message: string): void {
    const retrait = this.file.retirer(a);
    if (!retrait) return;
    a.decide({ behavior: 'deny', message, interrupt: false });
    this.suivante(retrait);
  }

  // La suivante de la file s'affiche ; sans elle, le dialogue disparaît.
  private suivante(retrait: Retrait): void {
    if (!retrait.etaitCourante) return;
    if (retrait.suivante) return this.publier(retrait.suivante);
    this.publication.maj({ dialogue: null, statut: 'travail' });
  }
}
