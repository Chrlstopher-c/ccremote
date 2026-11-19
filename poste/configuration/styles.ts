// Responsabilité : les styles de sortie de Claude — intégrés, fichiers `output-styles/*.md` des configurations et des
// projets, et création d'un style dans la configuration de la machine.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import type { Logger } from 'pino';
import type { StylesSession } from '../../commun/configuration.ts';
import { ecrireFrontmatter, lireFrontmatter } from './frontmatter.ts';

export const STYLES_INTEGRES: readonly string[] = ['default', 'Explanatory', 'Learning'];

export type ResultatStyle =
  { readonly ok: true; readonly nom: string } | { readonly ok: false; readonly erreur: string };

export function dossierClaudeDefaut(): string {
  return join(homedir(), '.claude');
}

/** Styles d'une session : ceux de sa configuration (ou de la config par défaut) et ceux de son projet. */
export function stylesDisque(
  configDir: string | null,
  cwd: string,
  style: string | null,
  journal: Logger,
): StylesSession {
  const dossiers = [configDir ?? dossierClaudeDefaut(), join(cwd, '.claude')];
  return { actuel: style ?? 'default', disponibles: listerStyles(dossiers, journal) };
}

export function listerStyles(dossiers: readonly string[], journal: Logger): string[] {
  const perso = dossiers.flatMap((d) => stylesDuDossier(join(d, 'output-styles'), journal));
  const uniques = [...new Set(perso)].sort((a, b) => a.localeCompare(b));
  return [...new Set([...STYLES_INTEGRES, ...uniques])];
}

function stylesDuDossier(dossier: string, journal: Logger): string[] {
  if (!existsSync(dossier)) return [];
  try {
    return readdirSync(dossier)
      .filter((fichier) => fichier.endsWith('.md'))
      .map((fichier) => nomStyle(join(dossier, fichier), fichier));
  } catch (erreur) {
    journal.warn({ err: erreur, dossier }, 'styles de sortie illisibles');
    return [];
  }
}

function nomStyle(chemin: string, fichier: string): string {
  const champs = lireFrontmatter(readFileSync(chemin, 'utf8'));
  return champs['name'] || basename(fichier, '.md');
}

/** Écrit `<dossierConfig>/output-styles/<slug>.md` ; un fichier existant n'est jamais écrasé. */
export function creerStyle(
  dossierConfig: string,
  c: { readonly nom: string; readonly description: string; readonly instructions: string },
  journal: Logger,
): ResultatStyle {
  if (STYLES_INTEGRES.some((integre) => integre.toLowerCase() === c.nom.toLowerCase()))
    return { ok: false, erreur: 'nom réservé à un style intégré' };
  const slug = slugDe(c.nom);
  if (!slug) return { ok: false, erreur: 'nom de style invalide' };
  const dossier = join(dossierConfig, 'output-styles');
  try {
    mkdirSync(dossier, { recursive: true });
    writeFileSync(
      join(dossier, `${slug}.md`),
      ecrireFrontmatter({ name: c.nom, description: c.description }, c.instructions),
      {
        flag: 'wx',
      },
    );
    return { ok: true, nom: c.nom };
  } catch (erreur) {
    if (estExistant(erreur)) return { ok: false, erreur: 'un style porte déjà ce nom' };
    journal.error({ err: erreur, dossier }, 'création du style impossible');
    return { ok: false, erreur: 'écriture du style impossible' };
  }
}

export function slugDe(nom: string): string {
  return nom
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function estExistant(erreur: unknown): boolean {
  return typeof erreur === 'object' && erreur !== null && 'code' in erreur && erreur.code === 'EEXIST';
}
