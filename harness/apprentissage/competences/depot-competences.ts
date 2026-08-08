/**
 * Responsabilité : lecture/écriture des `COMPETENCE.md` (C-8, SPEC §5.8) — le seul point
 * d'accès aux fichiers de compétences, sous `<racine>/<slug>/COMPETENCE.md`. Frontmatter
 * YAML minimal, écrit exclusivement par `ecrireCompetence` : le format est fermé et
 * entièrement sous notre contrôle, jamais produit par le modèle (voir `operations.ts` `☠`).
 *
 * Conception inspirée de Hermes Agent (Nous Research) — MIT. Transposition indépendante en TypeScript.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { executer, journal } from '../logger.ts';
import type { Competence, EtatCompetence, Portee } from '../types.ts';

export interface CorpsCompetence {
  /** Lignes de la section « Quand ça s'applique », sans puce. */
  readonly quand: readonly string[];
  /** Lignes de la section « Marche à suivre », sans numéro. */
  readonly etapes: readonly string[];
  /** Lignes de la section « Pièges déjà payés », sans puce. */
  readonly pieges: readonly string[];
}

export interface FichierCompetence {
  readonly competence: Competence;
  readonly corps: CorpsCompetence;
}

const NOM_FICHIER = 'COMPETENCE.md';
const PORTEES: readonly Portee[] = ['projet', 'machine', 'global'];
const ETATS: readonly EtatCompetence[] = ['candidate', 'active', 'dormante', 'obsolete'];

/** `CCREMOTE_APPRENTISSAGE_COMPETENCES_DIR`, repli `~/.local/share/ccremote/apprentissage/competences` (SPEC §5.8). */
export function cheminCompetencesParDefaut(): string {
  const depuisEnv = process.env['CCREMOTE_APPRENTISSAGE_COMPETENCES_DIR'];
  if (depuisEnv !== undefined && depuisEnv.length > 0) return depuisEnv;
  return join(homedir(), '.local', 'share', 'ccremote', 'apprentissage', 'competences');
}

/** kebab-case ASCII dérivé du nom proposé — devient le nom du dossier sous `racine`. */
export function slugifier(nom: string): string {
  const brut = nom
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return brut.length > 0 ? brut : 'competence';
}

function cheminFichier(racine: string, slug: string): string {
  return join(racine, slug, NOM_FICHIER);
}

function serialiserEntete(c: Competence): string {
  return [
    '---',
    `nom: ${c.nom}`,
    `description: ${c.description}`,
    `portee: ${c.portee}`,
    `projet: ${c.projet ?? 'null'}`,
    `etat: ${c.etat}`,
    `confirmations: ${c.confirmations}`,
    `origine: [${c.origine.join(', ')}]`,
    `maj: ${c.maj}`,
    '---',
    '',
  ].join('\n');
}

function puces(lignes: readonly string[], siVide: string): string {
  return lignes.length > 0 ? lignes.map((l) => `· ${l}`).join('\n') : siVide;
}

function numerotees(lignes: readonly string[], siVide: string): string {
  return lignes.length > 0 ? lignes.map((l, i) => `${i + 1}. ${l}`).join('\n') : siVide;
}

function serialiserCorps(corps: CorpsCompetence): string {
  return [
    "## Quand ça s'applique",
    puces(corps.quand, '· (à compléter)'),
    '',
    '## Marche à suivre',
    numerotees(corps.etapes, '1. (à compléter)'),
    '',
    '## Pièges déjà payés',
    puces(corps.pieges, '(aucun pour l’instant)'),
    '',
  ].join('\n');
}

function decouperFrontmatter(contenu: string): { readonly entete: string; readonly corps: string } {
  const correspondance = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(contenu);
  if (correspondance === null) throw new Error('COMPETENCE.md sans frontmatter YAML valide');
  return { entete: correspondance[1] ?? '', corps: correspondance[2] ?? '' };
}

function parserEntete(entete: string): Record<string, string> {
  const champs: Record<string, string> = {};
  for (const ligne of entete.split('\n')) {
    const s = ligne.trim();
    const i = s.indexOf(':');
    if (i === -1) continue;
    champs[s.slice(0, i).trim()] = s.slice(i + 1).trim();
  }
  return champs;
}

function parserListe(valeur: string | undefined): readonly string[] {
  const s = (valeur ?? '').trim();
  if (s.length === 0 || s === '[]') return [];
  const interieur = s.startsWith('[') && s.endsWith(']') ? s.slice(1, -1) : s;
  return interieur
    .split(',')
    .map((x) => x.trim())
    .filter((x) => x.length > 0);
}

/** Repli robuste : une valeur hors énumération retombe sur le premier élément accepté, journalisé. */
function versEnum<T extends string>(valeur: string | undefined, acceptees: readonly T[], champ: string, slug: string): T {
  if (valeur !== undefined && (acceptees as readonly string[]).includes(valeur)) {
    // Justifié : la valeur vient d'être vérifiée membre de `acceptees` à la ligne précédente.
    return valeur as T;
  }
  journal.warn({ slug, champ, valeur }, 'frontmatter de compétence corrompu — repli sur la première valeur acceptée');
  return acceptees[0]!;
}

function versCompetence(slug: string, champs: Record<string, string>): Competence {
  const projetBrut = champs['projet'];
  return {
    slug,
    nom: champs['nom'] ?? slug,
    description: champs['description'] ?? '',
    portee: versEnum(champs['portee'], PORTEES, 'portee', slug),
    projet: projetBrut === undefined || projetBrut === 'null' ? null : projetBrut,
    etat: versEnum(champs['etat'], ETATS, 'etat', slug),
    confirmations: Number.parseInt(champs['confirmations'] ?? '0', 10) || 0,
    origine: parserListe(champs['origine']),
    maj: champs['maj'] ?? '',
  };
}

function extraireSection(corps: string, titre: string): string {
  const motif = new RegExp(`## ${titre}\\n([\\s\\S]*?)(?=\\n## |$)`);
  const correspondance = motif.exec(corps);
  return correspondance?.[1] !== undefined ? correspondance[1].trim() : '';
}

function lignesPuces(section: string): readonly string[] {
  return section
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('· ') && l !== '· (à compléter)')
    .map((l) => l.slice(2).trim());
}

function lignesNumerotees(section: string): readonly string[] {
  return section
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => /^\d+\.\s/.test(l) && l !== '1. (à compléter)')
    .map((l) => l.replace(/^\d+\.\s/, ''));
}

function parserCorps(corps: string): CorpsCompetence {
  return {
    quand: lignesPuces(extraireSection(corps, "Quand ça s'applique")),
    etapes: lignesNumerotees(extraireSection(corps, 'Marche à suivre')),
    pieges: lignesPuces(extraireSection(corps, 'Pièges déjà payés')),
  };
}

/** Lit une compétence. `null` si le dossier/fichier n'existe pas — jamais une exception pour ce cas précis. */
export function lireCompetence(racine: string, slug: string): FichierCompetence | null {
  return executer(
    'lireCompetence',
    () => {
      const chemin = cheminFichier(racine, slug);
      if (!existsSync(chemin)) return null;
      const contenu = readFileSync(chemin, 'utf8');
      const { entete, corps } = decouperFrontmatter(contenu);
      return { competence: versCompetence(slug, parserEntete(entete)), corps: parserCorps(corps) };
    },
    { racine, slug },
  );
}

/** Écrit une compétence — création du dossier si absent, écrasement déterministe du fichier entier. */
export function ecrireCompetence(racine: string, fichier: FichierCompetence): void {
  executer(
    'ecrireCompetence',
    () => {
      const dossier = join(racine, fichier.competence.slug);
      mkdirSync(dossier, { recursive: true });
      const contenu = `${serialiserEntete(fichier.competence)}\n${serialiserCorps(fichier.corps)}`;
      writeFileSync(cheminFichier(racine, fichier.competence.slug), contenu, 'utf8');
    },
    { racine, slug: fichier.competence.slug },
  );
}

/** Slugs des compétences présentes sous `racine` (dossiers contenant un `COMPETENCE.md`). */
export function listerSlugsCompetences(racine: string): readonly string[] {
  return executer('listerSlugsCompetences', () => {
    if (!existsSync(racine)) return [];
    return readdirSync(racine, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .filter((nom) => existsSync(join(racine, nom, NOM_FICHIER)));
  });
}

/** Toutes les compétences lisibles sous `racine` — une entrée illisible est ignorée, journalisée. */
export function listerCompetences(racine: string): readonly Competence[] {
  return executer('listerCompetences', () => {
    const competences: Competence[] = [];
    for (const slug of listerSlugsCompetences(racine)) {
      try {
        const fichier = lireCompetence(racine, slug);
        if (fichier !== null) competences.push(fichier.competence);
      } catch (erreur) {
        journal.warn({ err: erreur, slug }, 'compétence illisible — ignorée');
      }
    }
    return competences;
  });
}

/**
 * Change l'état d'une compétence sans toucher son corps (E10, C-4 : consolidation/archivage).
 * `☠` Jamais de suppression : `obsolete` reste un dossier lisible, jamais effacé (SPEC §5, C-4
 * `☠`, réduction de H-9). `null` si le slug n'existe pas — jamais une exception.
 */
export function changerEtatCompetence(racine: string, slug: string, etat: EtatCompetence, maintenant: string): Competence | null {
  return executer(
    'changerEtatCompetence',
    () => {
      const fichier = lireCompetence(racine, slug);
      if (fichier === null) return null;
      const competence: Competence = { ...fichier.competence, etat, maj: maintenant };
      ecrireCompetence(racine, { competence, corps: fichier.corps });
      return competence;
    },
    { racine, slug, etat },
  );
}

/**
 * Compétences `active` servables à `projet` (C-6, SPEC §5.6) : portée `projet` sur ce projet
 * exact, ou portée `machine`/`global` (aucun champ machine sur `Competence` — servie partout).
 * Triées par confirmations décroissantes.
 */
export function listerCompetencesServables(racine: string, projet: string): readonly Competence[] {
  return executer('listerCompetencesServables', () => {
    return listerCompetences(racine)
      .filter((c) => c.etat === 'active')
      .filter((c) => c.portee !== 'projet' || c.projet === projet)
      .sort((a, b) => b.confirmations - a.confirmations);
  });
}
