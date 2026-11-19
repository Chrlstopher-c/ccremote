// Responsabilité : le contrat qu'une session du poste offre au gestionnaire et au socket local, quel que soit son
// moteur — `tmux` (TUI dans un serveur tmux) ou `sdk` (Claude Agent SDK). Le gestionnaire ne parle qu'à cette forme.
import type { PieceJointe } from '../../commun/presentation.ts';
import type { EffortSession, Evenement, ModeSession, ReponseDialogue, ResumeSession } from '../../commun/session.ts';
import type { DecisionCrochet } from './garde-sous-agents.ts';
import type { SessionPersistee } from './persistance.ts';
import type { PaneTmux } from './tmux.ts';

// Réglage changé en cours de session (commande `mode`, `modele`, `effort`, `renommer`, `style` du relais).
export type Reglage =
  | { readonly kind: 'mode'; readonly mode: ModeSession }
  | { readonly kind: 'modele'; readonly modele: string }
  | { readonly kind: 'effort'; readonly effort: EffortSession | null }
  | { readonly kind: 'renommer'; readonly titre: string }
  | { readonly kind: 'style'; readonly style: string | null };

export interface SortieSession {
  evenement(sessionId: string, evt: Evenement): void;
  resume(r: ResumeSession): void;
}

// Réponse d'un crochet du CLI (sessions pilotées dans tmux seulement).
export type ReponseCrochet = DecisionCrochet | { decision?: 'block'; reason?: string };

export interface SessionPoste {
  readonly resume: ResumeSession;
  readonly persistee: SessionPersistee;
  readonly transcriptConnu: boolean;
  readonly vivante: boolean; // un processus Claude tourne pour cette session (tmux ou requête SDK ouverte)

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
