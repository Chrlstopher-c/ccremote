// Responsabilité : le contrat de l'API des clients (app de bureau, iPhone, web) — ce que le relais rend et pousse.
import type { EtatMachine } from './protocole-poste.ts';
import type { Evenement, Projet, ResumeSession } from './session.ts';

export interface VueMachine {
  readonly id: string;
  readonly description: string;
  readonly racines: string[];
  readonly projets: Projet[];
  readonly comptes: string[];
  readonly version: string;
  readonly etat: EtatMachine | null;
  readonly derniereVue: string;
  readonly enLigne: boolean;
}

export interface EvenementDate { readonly seq: number; readonly sessionId: string; readonly ts: string; readonly evt: Evenement }

export interface Notification {
  readonly seq: number;
  readonly sessionId: string | null;
  readonly niveau: 'info' | 'important' | 'alerte';
  readonly titre: string;
  readonly texte: string;
  readonly ts: string;
  readonly lue: boolean;
}

export interface EtatRelais {
  readonly version: number;
  readonly machines: VueMachine[];
  readonly sessions: ResumeSession[];
  readonly notifications: Notification[];
  readonly reveilPossible: string[];
}

export type MessageClient =
  | { readonly type: 'evenement'; readonly evenement: EvenementDate }
  | { readonly type: 'session'; readonly session: ResumeSession }
  | { readonly type: 'machine'; readonly machine: VueMachine }
  | { readonly type: 'notification'; readonly notification: Notification };

export interface DemandeOuverture {
  readonly machine: string;
  readonly projet: Projet;
  readonly message: string;
  readonly titre?: string;
  readonly objectif?: string | null;
  readonly autonomie?: boolean;
  readonly modele?: string;
  readonly compte?: string;
}

export type ActionSession = 'interrompre' | 'compacter' | 'fermer' | 'reprendre';
