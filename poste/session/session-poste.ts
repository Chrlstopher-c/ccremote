// Responsabilité : le contrat qu'une session du poste offre au gestionnaire et au socket local, quel que soit son
// moteur — `tmux` (TUI dans un serveur tmux) ou `sdk` (Claude Agent SDK). Le gestionnaire ne parle qu'à cette forme.
import type { SDKControlGetUsageResponse } from '@anthropic-ai/claude-agent-sdk';
import type { Decouverte } from '../../commun/decouverte.ts';
import type { PieceJointe } from '../../commun/presentation.ts';
import type { EffortSession, Evenement, ModeSession, ReponseDialogue, ResumeSession } from '../../commun/session.ts';
import type { DecisionCrochet } from './garde-sous-agents.ts';
import type { EvenementHorodate } from './historique.ts';
import type { SessionPersistee } from './persistance.ts';
import type { PaneTmux } from './tmux.ts';

// Réglage changé en cours de session (`mode`, `modele`, `effort`, `renommer`, `style`, `rapide`, `ultracode`).
export type Reglage =
  | { readonly kind: 'mode'; readonly mode: ModeSession }
  | { readonly kind: 'modele'; readonly modele: string }
  | { readonly kind: 'effort'; readonly effort: EffortSession | null }
  | { readonly kind: 'renommer'; readonly titre: string }
  | { readonly kind: 'style'; readonly style: string | null }
  | { readonly kind: 'rapide'; readonly actif: boolean }
  | { readonly kind: 'ultracode'; readonly actif: boolean };

export interface SortieSession {
  evenement(sessionId: string, evt: Evenement): void;
  /** Historique complet d'une session (transcript relu à l'ouverture) : un lot, sans notifications. */
  historique?(sessionId: string, evenements: readonly EvenementHorodate[]): void;
  resume(r: ResumeSession): void;
  decouvertes?(liste: Decouverte[]): void; // sessions du poste pas encore ouvertes : liste complète à chaque changement
}

// Réponse d'un crochet du CLI (sessions pilotées dans tmux seulement).
export type ReponseCrochet = DecisionCrochet | { decision?: 'block'; reason?: string };

export interface SessionPoste {
  readonly resume: ResumeSession;
  readonly persistee: SessionPersistee;
  readonly transcriptConnu: boolean;
  readonly identifiants: readonly string[]; // identifiants SDK anciens et courant (voir identifiants-fiche.ts)
  readonly vivante: boolean; // un processus Claude tourne pour cette session (tmux ou requête SDK ouverte)
  /** Usage du compte, lu sur la requête SDK ouverte (absent hors SDK). */
  usageSdk?(): Promise<SDKControlGetUsageResponse | null>;

  // Découverte : ce que la machine voit de la session.
  rattacher(pane: PaneTmux | null): void;
  /** Nom donné par `cc` (tmux seulement ; une session SDK porte son titre). */
  nommer?(nom: string | null): void;
  rattacherTerminal(vivant: boolean): void;
  definirTranscript(chemin: string, historique: number, claudeSessionId: string): void;
  lire(): void;
  releverEcran(): Promise<void>;
  veillerNuit(maintenant?: number): Promise<void>;

  // Commandes de Chris, relayées par le gestionnaire.
  lancer(message: string, modele: string | null, pieces?: readonly PieceJointe[]): Promise<string | null>;
  envoyer(texte: string, pieces?: readonly PieceJointe[]): Promise<string | null>;
  interrompre(): Promise<string | null>;
  compacter(): Promise<string | null>;
  fermer(): Promise<string | null>;
  reprendre(message?: string): Promise<string | null>;
  basculerAutonomie(active: boolean): void;
  basculerNuit(active: boolean, objectif?: string): Promise<string | null>;
  repondre(r: ReponseDialogue): Promise<string | null>;
  reglerSession(r: Reglage): Promise<string | null>;

  // Socket local : crochets (tmux seulement) et outils de rythme (tmux et SDK).
  crochet(type: string, entree: Record<string, unknown>): ReponseCrochet;
  rythme(outil: string, args: Record<string, unknown>): string;
}
