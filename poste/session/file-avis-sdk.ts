// Responsabilité : la file des demandes qui attendent Chris dans une session SDK (questions AskUserQuestion, plan
// ExitPlanMode, permissions d'outil). Une seule est affichée à la fois, la première ; les autres attendent leur tour.
// Pur : la publication de la courante et la rédaction de la décision au SDK restent à la session.
import type { PermissionResult, PermissionUpdate } from '@anthropic-ai/claude-agent-sdk';
import type { Question } from './questions-sdk.ts';

export interface AvisEnAttente {
  readonly outil: string;
  readonly entree: Record<string, unknown>;
  readonly restantes: Question[]; // questions à poser une à une (vide pour une permission)
  readonly reponses: Record<string, string>;
  readonly suggestions: readonly PermissionUpdate[]; // règles proposées par le SDK (permission seulement)
  readonly permission: boolean;
  id: string;
  readonly decide: (r: PermissionResult) => void;
}

export interface Retrait {
  readonly etaitCourante: boolean;
  readonly suivante: AvisEnAttente | undefined;
}

export class FileAvis {
  private readonly file: AvisEnAttente[] = [];

  get courante(): AvisEnAttente | undefined {
    return this.file[0];
  }

  /** Ajoute une demande ; vrai si elle devient la courante, donc à afficher tout de suite. */
  ajouter(avis: AvisEnAttente): boolean {
    this.file.push(avis);
    return this.file.length === 1;
  }

  /** Retire une demande de la file ; null si elle n'y est plus (déjà réglée). */
  retirer(avis: AvisEnAttente): Retrait | null {
    const rang = this.file.indexOf(avis);
    if (rang < 0) return null;
    this.file.splice(rang, 1);
    return { etaitCourante: rang === 0, suivante: this.file[0] };
  }

  /** Vide la file et rend ce qu'elle contenait, la courante en premier. */
  vider(): AvisEnAttente[] {
    return this.file.splice(0);
  }
}
