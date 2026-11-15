// Responsabilité : le contrat de données lu depuis le relais, réduit aux champs qu'Agent HQ utilise. Miroir typé de
// commun/session.ts et commun/api-clients.ts : hq/tsconfig.json n'autorise pas les imports en .ts, on ne peut donc pas
// importer commun/ directement. Tout changement de commun/ se reporte ici.

export type StatutSession =
  | 'demarrage'
  | 'travail'
  | 'compaction'
  | 'attente'
  | 'question'
  | 'terminee'
  | 'erreur'
  | 'fermee';

export interface Projet {
  readonly machine: string;
  readonly chemin: string;
  readonly nom: string;
}

export interface OptionDialogue {
  readonly libelle: string;
  readonly description: string;
}

export interface Dialogue {
  readonly id: string;
  readonly titre: string;
  readonly options: readonly OptionDialogue[];
  readonly multiple: boolean;
  readonly saisie: number | null;
  readonly coches: readonly number[];
}

export interface ReponseDialogue {
  readonly id: string;
  readonly index?: number;
  readonly cases?: readonly number[];
  readonly texte?: string;
}

export interface ResumeSession {
  readonly id: string;
  readonly machine: string;
  readonly projet: Projet;
  readonly cwd: string;
  readonly titre: string;
  readonly objectif: string | null;
  readonly modele: string;
  readonly compte: string;
  readonly autonomie: boolean;
  readonly statut: StatutSession;
  readonly contexte: { readonly tokens: number; readonly max: number };
  readonly etapes: number;
  readonly compactions: number;
  readonly claudeSessionId: string | null;
  readonly moteur?: 'sdk' | 'tmux';
  readonly tmux: string | null;
  readonly attachee: boolean;
  readonly pilotee: boolean;
  readonly terminal?: boolean;
  readonly dialogue?: Dialogue | null;
  readonly creeLe: string;
  readonly majLe: string;
  // Champs ajoutés au contrat : absents sur un relais ancien (undefined = comme null / non archivée).
  readonly inactiveDepuis?: string | null;
  readonly archivee?: boolean;
}

interface AvecAgent {
  readonly agent?: string;
}

export type Evenement = (
  | { readonly type: 'message'; readonly texte: string }
  | { readonly type: 'texte'; readonly texte: string }
  | { readonly type: 'flux'; readonly bloc: string; readonly delta: string }
  | { readonly type: 'reflexion'; readonly texte: string }
  | {
      readonly type: 'outil';
      readonly id: string;
      readonly nom: string;
      readonly resume: string;
      readonly detail: string;
    }
  | { readonly type: 'resultat_outil'; readonly outilId: string; readonly extrait: string; readonly erreur: boolean }
  | {
      readonly type: 'sous_agent';
      readonly id: string;
      readonly description: string;
      readonly modele: string;
      readonly genre: string;
    }
  | { readonly type: 'etape'; readonly resume: string; readonly suite: string }
  | { readonly type: 'objectif_atteint'; readonly bilan: string }
  | { readonly type: 'question'; readonly question: string }
  | { readonly type: 'compaction'; readonly avant: number; readonly apres: number; readonly declencheur: string }
  | { readonly type: 'relance'; readonly raison: string }
  | { readonly type: 'tour_fini'; readonly dureeMs: number; readonly contexte: number }
  | { readonly type: 'erreur'; readonly message: string }
) &
  AvecAgent;

export interface EvenementDate {
  readonly seq: number;
  readonly sessionId: string;
  readonly ts: string;
  readonly evt: Evenement;
}

export interface Notification {
  readonly seq: number;
  readonly sessionId: string | null;
  readonly niveau: 'info' | 'important' | 'alerte';
  readonly titre: string;
  readonly texte: string;
  readonly ts: string;
  readonly lue: boolean;
}

export interface VueMachine {
  readonly id: string;
  readonly description: string;
  readonly racines: readonly string[];
  readonly projets: readonly Projet[];
  readonly version: string;
  readonly etat: { readonly cpu: number; readonly charge: number } | null;
  readonly derniereVue: string;
  readonly enLigne: boolean;
}

export interface EtatRelais {
  readonly version: number;
  readonly machines: readonly VueMachine[];
  readonly sessions: readonly ResumeSession[];
  readonly notifications: readonly Notification[];
  readonly reveilPossible: readonly string[];
}

export type MessageClient =
  | { readonly type: 'evenement'; readonly evenement: EvenementDate }
  | { readonly type: 'session'; readonly session: ResumeSession }
  | { readonly type: 'machine'; readonly machine: VueMachine }
  | { readonly type: 'notification'; readonly notification: Notification }
  | { readonly type: 'echo'; readonly echo: unknown };

// Actions de session : les quatre du relais, plus archiver/desarchiver (ajoutées au contrat en parallèle).
export type ActionSession = 'interrompre' | 'compacter' | 'fermer' | 'reprendre' | 'archiver' | 'desarchiver';
