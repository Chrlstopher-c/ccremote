// Responsabilité : ce que Quart relaie d'Echo (dépôt `echo`, commun/conversation.ts) — copie des seuls champs affichés.

// `origine` : qui a lancé le tour (« quart:<appareil> », « voix:portable », « quart » pour les arrêts, « interne »).
export type MessageEcho =
  | { readonly type: 'delta'; readonly texte: string; readonly origine: string }
  | { readonly type: 'phrase'; readonly texte: string; readonly origine: string }
  | { readonly type: 'outil'; readonly nom: string; readonly origine: string }
  | { readonly type: 'fin'; readonly texte: string; readonly origine: string }
  | { readonly type: 'etat'; readonly occupe: boolean }
  | { readonly type: 'erreur'; readonly message: string }
  | { readonly type: 'niveau'; readonly source: 'micro' | 'voix'; readonly v: number }
  | {
      readonly type: 'entendu';
      readonly texte: string;
      readonly eveil: boolean;
      readonly score?: number | null; // ressemblance avec la voix de Chris (null : non vérifiée)
      readonly refusee?: boolean;
    }
  | { readonly type: 'voix'; readonly etat: EtatVoixEcho }
  | { readonly type: 'usage'; readonly usage: UsageEcho }
  | { readonly type: 'mcp'; readonly serveurs: readonly McpEcho[] }
  | { readonly type: 'contexte'; readonly etat: ContexteEcho }
  | { readonly type: 'reveil'; readonly attente: ReveilEcho | null }
  | { readonly type: 'voix_commande'; readonly action: CommandeVoix }
  | { readonly type: 'reglages'; readonly reglages: ReglagesEcho }
  | { readonly type: 'cadres'; readonly cadres: readonly CadreEcho[] };

// Consommation d'Echo chez Anthropic sur la journée (dollars : équivalent API, non facturés par l'abonnement).
export interface UsageEcho {
  readonly jour: string;
  readonly tours: number;
  readonly entree: number;
  readonly sortie: number;
  readonly cache: number;
  readonly dollars: number;
}

// Un serveur MCP d'Echo et son état (machine : d'où il vient ; « echo » = outils internes, « pi » = connecteurs).
export interface McpEcho {
  readonly nom: string;
  readonly statut: string;
  readonly machine: string;
}

// Le contexte de la session d'Echo et ses compactions (autocompact : au repos au-delà de seuilRepos, en fin de tour
// au-delà de seuilDur).
export interface ContexteEcho {
  readonly tokens: number;
  readonly fenetre: number;
  readonly seuilRepos: number;
  readonly seuilDur: number;
  readonly compactions: number;
  readonly enCours: boolean;
  readonly derniere: string | null;
}

export type CommandeVoix = 'enroler' | 'oublier' | 'annuler';

// L'empreinte vocale de Chris, vue du terminal qui écoute.
export interface EtatVoixEcho {
  readonly terminal: string;
  readonly profil: boolean | null;
  readonly enrolement: { readonly duree: number; readonly cible: number } | null;
  readonly seuil: number;
}

export interface ReglagesEcho {
  readonly micro: boolean;
  readonly voix: boolean;
}

// Ce qu'Echo montre à côté de son orbe (contenu produit par Echo : à rendre sans jamais l'exécuter).
export interface CadreEcho {
  readonly id: string;
  readonly titre: string;
  readonly genre: 'markdown' | 'stats' | 'svg' | 'web' | 'image' | 'code';
  readonly contenu: string;
  readonly langue?: string;
  readonly stats?: readonly { readonly libelle: string; readonly valeur: string; readonly detail?: string }[];
}

export interface EtatEcho {
  readonly joignable: boolean;
  readonly occupe: boolean;
  readonly reglages: ReglagesEcho;
  readonly cadres: readonly CadreEcho[];
  readonly voix: EtatVoixEcho | null;
  readonly usage: UsageEcho | null;
  readonly mcp: readonly McpEcho[];
  readonly contexte: ContexteEcho | null;
  readonly reveil: ReveilEcho | null;
}

// Un terminal n'atteint plus les sens, leur machine est éteinte : Echo attend que Chris décide de la réveiller.
export interface ReveilEcho {
  readonly machine: string;
  readonly depuis: string;
  readonly statut: 'attente' | 'en_cours';
}

export type DecisionReveil = 'reveiller' | 'ignorer';

export interface EntreeHistoriqueEcho {
  readonly ts: string;
  readonly qui: 'chris' | 'echo' | 'quart';
  readonly origine: string;
  readonly texte: string;
}
