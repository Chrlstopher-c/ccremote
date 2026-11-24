// Types du client `client.mjs` (JS pur) : les modules TypeScript du dépôt les importent avec ces déclarations.

export const MODULE_NAV: 'navigateur';
export const VAR_SESSION_NAV: 'LANTERNE_SESSION_PILOTEE';
export const VAR_SOCKET_NAV: 'LANTERNE_SOCKET_OUTILS';

export const OUTILS_NAV: readonly OutilNav[];

export type OutilNav =
  | 'ouvrir'
  | 'aller'
  | 'precedent'
  | 'recharger'
  | 'fermer'
  | 'etat'
  | 'lire'
  | 'texte'
  | 'trouver'
  | 'cliquer'
  | 'saisir'
  | 'touche'
  | 'defiler'
  | 'executer';

export type ArgsNav = Readonly<Record<string, unknown>>;

export interface PageNav {
  readonly url: string;
  readonly titre: string;
  readonly arbre: string;
}

export interface TexteNav {
  readonly url: string;
  readonly titre: string;
  readonly texte: string;
}

export interface EtatNav {
  readonly ouvert: boolean;
  readonly url?: string;
  readonly titre?: string;
}

export interface ResultatNav {
  readonly ok: true;
  readonly url?: string;
  readonly y?: number;
  readonly resultat?: unknown;
  readonly resultats?: readonly { readonly ref: string; readonly role: string; readonly nom: string }[];
}

export interface Navigateur {
  ouvrir(args?: ArgsNav): Promise<unknown>;
  aller(args: { readonly url: string }): Promise<ResultatNav>;
  precedent(args?: ArgsNav): Promise<unknown>;
  recharger(args?: ArgsNav): Promise<unknown>;
  fermer(args?: ArgsNav): Promise<unknown>;
  etat(args?: ArgsNav): Promise<EtatNav>;
  lire(args?: { readonly filtre?: 'interactifs' | 'tout' }): Promise<PageNav>;
  texte(args?: ArgsNav): Promise<TexteNav>;
  trouver(args: { readonly requete: string }): Promise<ResultatNav>;
  cliquer(args: { readonly ref: string } | { readonly x: number; readonly y: number }): Promise<ResultatNav>;
  saisir(args: { readonly ref: string; readonly texte: string; readonly valider?: boolean }): Promise<ResultatNav>;
  touche(args: { readonly touche: string }): Promise<ResultatNav>;
  defiler(args: { readonly direction: 'haut' | 'bas'; readonly quantite?: number }): Promise<ResultatNav>;
  executer(args: { readonly js: string }): Promise<ResultatNav>;
}

export function cheminSocketNav(
  env: Readonly<Record<string, string | undefined>>,
  uid: number | undefined,
  donnees?: string,
): string;

export function appelerNav(
  outil: OutilNav,
  args?: ArgsNav,
  env?: Readonly<Record<string, string | undefined>>,
): Promise<unknown>;

export function creerNav(env?: Readonly<Record<string, string | undefined>>): Navigateur;

export const nav: Navigateur;
