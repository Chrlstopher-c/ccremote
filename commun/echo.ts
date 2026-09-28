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
  | { readonly type: 'entendu'; readonly texte: string; readonly eveil: boolean }
  | { readonly type: 'reglages'; readonly reglages: ReglagesEcho }
  | { readonly type: 'cadres'; readonly cadres: readonly CadreEcho[] };

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
}

export interface EntreeHistoriqueEcho {
  readonly ts: string;
  readonly qui: 'chris' | 'echo' | 'quart';
  readonly origine: string;
  readonly texte: string;
}
