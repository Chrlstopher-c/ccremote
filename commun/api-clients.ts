// Responsabilité : le contrat de l'API des clients (app de bureau, iPhone, web) — ce que le relais rend et pousse.
import type { EtatCompte } from './comptes.ts';
import type { MessageEcho } from './echo.ts';
import type { Reunion } from './reunion.ts';
import type { DemandeDuo } from './duo.ts';
import type { EtatMachine } from './protocole-poste.ts';
import type { Evenement, Projet, ResumeSession } from './session.ts';

/** Accès d'une machine au relais : local, connecte, connexion (tunnel ouvert, poste pas encore là), injoignable… */
export type EtatAccesMachine = 'local' | 'connecte' | 'connexion' | 'injoignable' | 'non_installe';

export interface AccesVue {
  readonly etat: EtatAccesMachine;
  readonly detail: string | null;
  readonly depuis: string; // iso : moment du dernier changement d'état
}

/** Installation du poste par SSH : étape courante, état, message (fin de sortie assainie si échec). */
export interface VueInstallation {
  readonly etape: string;
  readonly etat: 'en_cours' | 'fini' | 'echec';
  readonly message: string | null;
}

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
  readonly acces?: AccesVue; // absent sur un relais sans machines SSH (moteur d'avant la vague 6)
  readonly installation?: VueInstallation | null; // dernière installation par SSH (absente hors relais intégré)
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
  // Delta de texte ou de réflexion en cours d'écriture : WebSocket seulement, jamais dans le fil ni le long-poll.
  | { readonly type: 'flux'; readonly sessionId: string; readonly bloc: string; readonly delta: string; readonly genre?: 'texte' | 'reflexion'; readonly agent?: string }
  | { readonly type: 'session'; readonly session: ResumeSession }
  // Session supprimée par Chris : chaque client la retire de sa liste et de son fil.
  | { readonly type: 'supprimee'; readonly id: string }
  | { readonly type: 'machine'; readonly machine: VueMachine }
  // Machine qui sort de la vue (nœud révoqué, plus relié) : chaque client la retire de sa liste.
  | { readonly type: 'machine_retiree'; readonly id: string }
  | { readonly type: 'notification'; readonly notification: Notification }
  | { readonly type: 'echo'; readonly echo: MessageEcho } // WebSocket seulement : n'avance pas le long-poll
  | { readonly type: 'reunion'; readonly reunion: Reunion } // WebSocket seulement : la salle de réunion (HQ)
  | { readonly type: 'confirmation'; readonly confirmation: ConfirmationDemandee } // une question de Claude à Chris
  // Le fil d'une session a changé sans qu'un événement en queue le montre (comblement, réécriture, remplacement) : le
  // client qui l'affiche le relit. Un ajout en queue est diffusé ligne à ligne et n'émet pas ce signal.
  | { readonly type: 'fil_modifie'; readonly sessionId: string }
  // Un module du parc a été ajouté, changé ou retiré : l'interface recharge la liste (voir relais/modules/).
  | { readonly type: 'modules_modifies' }
  // Mode duo : l'état du lien ou des partages a changé (l'interface relit GET /api/duo).
  | { readonly type: 'duo_modifie' }
  // Synchronisations sur demande : demandes reçues ou envoyées, décisions, journal (relire GET /api/synchro).
  | { readonly type: 'synchro_modifie' }
  | { readonly type: 'federation_modifiee' } // la fédération « mes machines » a changé : relire /api/federation
  // Mode duo : le pair demande un accord (écrire sans permissions, ouvrir une session) ; Chris tranche.
  | { readonly type: 'duo_demande'; readonly demande: DemandeDuo }
  // L'issue d'une requête qui attendait l'accord du pair (ouvrir une session, passer la main) : accord ou refus.
  | {
      readonly type: 'duo_issue';
      readonly demande: string;
      readonly accord: boolean;
      readonly session?: string;
      readonly raison?: string;
    }
  // Le pair a ouvert (present) ou fermé une session partagée avec Chris.
  | { readonly type: 'duo_presence'; readonly session: string; readonly present: boolean }
  // Un fichier touché des deux côtés (Chris et le pair) dans un projet partagé : une alerte par fichier et par 30 min.
  | {
      readonly type: 'duo_conflit';
      readonly projet: string;
      readonly fichier: string;
      readonly qui: string;
      readonly session: string;
      readonly sessionPair: string;
    }
  // Un agent appelle un outil d'un module : la première appli où il est actif répond (POST /api/modules-reponses).
  // WebSocket seulement : n'avance pas le long-poll.
  | {
      readonly type: 'module_appel';
      readonly appel: string;
      readonly module: string;
      readonly outil: string;
      readonly arguments: Readonly<Record<string, unknown>>;
      readonly session: string | null;
    };

/** Forme publique d'une confirmation demandée par un outil (voir relais/machines/confirmations.ts). */
export interface ConfirmationDemandee {
  readonly id: string;
  readonly action: string;
  readonly cible: string;
  readonly resume: string;
  readonly statut: 'en_attente' | 'accordee' | 'refusee' | 'expiree';
  readonly cree_le: string;
}

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

// `archiver` / `desarchiver` : rangement manuel (jamais automatique). Archiver ferme d'abord une session vivante.
export type ActionSession = 'interrompre' | 'compacter' | 'fermer' | 'reprendre' | 'archiver' | 'desarchiver';

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
