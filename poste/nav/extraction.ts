// Responsabilité : extraire la CLI `noctis-nav` du binaire compilé vers le dossier de données du poste, avec ses
// lanceurs (sh et cmd) : `node` s'il est présent, sinon le binaire du poste (sous-commande `nav`). Réécrit seulement ce
// qui diffère. En développement, rien à extraire : la CLI est le dossier source.
import { mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import type { Logger } from 'pino';
import { SOURCES_NAV } from './embarque.ts';
import { DOSSIER_NAV, dossierNav, enBinaire, fixerDossierNav } from './environnement.ts';

export const SOUS_COMMANDE_NAV = 'nav';

export interface OptionsExtraction {
  readonly binaire?: string; // le binaire du poste (process.execPath par défaut)
  readonly embarquee?: boolean; // le poste tourne depuis le binaire compilé (détecté par défaut)
  readonly windows?: boolean; // lanceur cmd plutôt que sh (plateforme par défaut)
}

const CRLF = '\r\n';

function quoteSh(texte: string): string {
  return `'${texte.replace(/'/g, "'\\''")}'`;
}

export function lanceurUnix(binaire: string, dossier: string): string {
  return [
    '#!/bin/sh',
    '# CLI noctis-nav, extraite par le poste : node si présent, sinon le binaire du poste (sous-commande nav).',
    'case $0 in */*) DIR=${0%/*} ;; *) DIR=. ;; esac',
    'if command -v node >/dev/null 2>&1; then exec node "$DIR/entree.mjs" "$@"; fi',
    `exec ${quoteSh(binaire)} ${SOUS_COMMANDE_NAV} ${quoteSh(dossier)} "$@"`,
    '',
  ].join('\n');
}

export function lanceurWindows(binaire: string, dossier: string): string {
  return [
    '@echo off',
    'where node >nul 2>nul',
    'if not errorlevel 1 (',
    '  node "%~dp0entree.mjs" %*',
    '  exit /b',
    ')',
    `"${binaire}" ${SOUS_COMMANDE_NAV} "${dossier}" %*`,
    '',
  ].join(CRLF);
}

/** Les fichiers à extraire, lanceur compris, et le nom du lanceur (chmod 0755 sous Linux). */
export function fichiersNav(
  binaire: string,
  dossier: string,
  windows: boolean,
): { fichiers: Record<string, string>; lanceur: string } {
  const lanceur = windows ? 'noctis-nav.cmd' : 'noctis-nav';
  const contenu = windows ? lanceurWindows(binaire, dossier) : lanceurUnix(binaire, dossier);
  return { fichiers: { ...SOURCES_NAV, [lanceur]: contenu }, lanceur };
}

function lireSiExiste(chemin: string): string | null {
  try {
    return readFileSync(chemin, 'utf8');
  } catch {
    return null;
  }
}

/** Écrit les fichiers dans `dossier`, sans toucher à ceux qui sont déjà identiques. */
export function ecrireNav(dossier: string, fichiers: Readonly<Record<string, string>>, lanceur: string): void {
  mkdirSync(dossier, { recursive: true, mode: 0o700 });
  for (const [nom, contenu] of Object.entries(fichiers)) {
    const chemin = join(dossier, nom);
    if (lireSiExiste(chemin) !== contenu) writeFileSync(chemin, contenu);
    if (nom === lanceur) chmodSync(chemin, 0o755);
  }
}

/** Au démarrage du poste : extrait la CLI et la fixe pour les sessions. Rend son dossier, ou null (log, sans CLI). */
export function preparerNav(donnees: string, journal: Logger, options: OptionsExtraction = {}): string | null {
  const embarquee = options.embarquee ?? enBinaire(DOSSIER_NAV);
  if (!embarquee) return dossierNav();
  const dossier = join(donnees, 'nav');
  try {
    const windows = options.windows ?? process.platform === 'win32';
    const { fichiers, lanceur } = fichiersNav(options.binaire ?? process.execPath, dossier, windows);
    ecrireNav(dossier, fichiers, lanceur);
    fixerDossierNav(dossier);
    journal.info({ dossier }, 'CLI noctis-nav extraite');
    return dossier;
  } catch (erreur) {
    journal.error({ err: erreur, dossier }, 'CLI noctis-nav indisponible : extraction impossible');
    fixerDossierNav(null);
    return null;
  }
}
