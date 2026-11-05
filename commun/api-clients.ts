// Responsabilité : le contrat de l'API des clients (app de bureau, iPhone, web) — ce que le relais rend et pousse.
import type { EtatCompte } from './comptes.ts';
import type { MessageEcho } from './echo.ts';
import type { EtatMachine } from './protocole-poste.ts';
import type { Evenement, Projet, ResumeSession } from './session.ts';

export interface VueMachine {
  readonly id: string;
  readonly description: string;
  readonly racines: string[];
  readonly projets: Projet[];
  readonly comptes: string[];
  readonly etatComptes: EtatCompte[]; // identité et usage relevés par le poste (dernière vue, même hors ligne)
  readonly version: string;
  readonly etat: EtatMachine | null;
  readonly derniereVue: string;
  readonly enLigne: boolean;
}

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
  | { readonly type: 'notification'; readonly notification: Notification }
  | { readonly type: 'echo'; readonly echo: MessageEcho }; // WebSocket seulement : n'avance pas le long-poll

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

// Un accès au relais : un appareil connecté par mot de passe (app, web, iPhone) ou un connecteur Claude (MCP).
export const GENRES_ACCES = ['appareil', 'claude-code', 'claude-ai'] as const;
export type GenreAcces = (typeof GENRES_ACCES)[number];

export interface VueAcces {
  readonly id: string; // début de l'empreinte du jeton : désigne l'accès sans rien révéler
  readonly nom: string;
  readonly genre: GenreAcces;
  readonly creeLe: string;
  readonly expireLe: string;
  readonly vuLe: string | null;
  readonly courant: boolean; // l'accès de l'appareil qui demande la liste
}

export interface DemandeAcces {
  readonly nom: string;
  readonly genre: Exclude<GenreAcces, 'appareil'>;
  readonly jours: number;
}

export interface NouvelAcces {
  readonly id: string;
  readonly jeton: string; // montré une seule fois
}
