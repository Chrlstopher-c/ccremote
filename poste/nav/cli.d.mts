// Types de `cli.mjs` : analyse des arguments et exécution de la CLI `noctis-nav`.

import type { ArgsNav, OutilNav } from './client.d.mts';

export class ErreurUsage extends Error {}

export function valeurCli(brut: string): unknown;

export function lireParametre(texte: string): [string, unknown];

export type Analyse =
  | { readonly aide: true }
  | { readonly aide: false; readonly outil: OutilNav; readonly args: ArgsNav };

export function analyser(argv: readonly string[]): Analyse;

export function texteAide(): string;

export interface SortiesCli {
  sortie(texte: string): void;
  erreur(texte: string): void;
}

export function executerCli(
  argv: readonly string[],
  sorties?: SortiesCli,
  appeler?: (outil: OutilNav, args: ArgsNav) => Promise<unknown>,
): Promise<number>;
