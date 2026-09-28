// Responsabilité : ce que Quart relaie d'Echo (dépôt `echo`, commun/conversation.ts) — copie des seuls champs affichés.

// `origine` : qui a lancé le tour (« quart:<appareil> », « voix:portable », « quart » pour les arrêts, « interne »).
export type MessageEcho =
  | { readonly type: 'delta'; readonly texte: string; readonly origine: string }
  | { readonly type: 'phrase'; readonly texte: string; readonly origine: string }
  | { readonly type: 'outil'; readonly nom: string; readonly origine: string }
  | { readonly type: 'fin'; readonly texte: string; readonly origine: string }
  | { readonly type: 'etat'; readonly occupe: boolean }
  | { readonly type: 'erreur'; readonly message: string };

export interface EntreeHistoriqueEcho {
  readonly ts: string;
  readonly qui: 'chris' | 'echo' | 'quart';
  readonly origine: string;
  readonly texte: string;
}
