// Responsabilité : les compétences (skills) de la machine — `skills/*/SKILL.md` de la configuration Claude et des
// plug-ins activés. Le contenu d'une compétence n'est lu que s'il figure dans cette liste.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Logger } from 'pino';
import type { CompetenceMachine } from '../../commun/configuration.ts';
import { lireFrontmatter } from './frontmatter.ts';
import type { PluginBrut } from './plugins.ts';

type Trouvee = Pick<CompetenceMachine, 'nom' | 'description' | 'chemin'>;

export function listerCompetences(
  dossierConfig: string,
  plugins: readonly PluginBrut[],
  journal: Logger,
): CompetenceMachine[] {
  const utilisateur: CompetenceMachine[] = skillsDe(join(dossierConfig, 'skills'), journal).map((c) => ({
    ...c,
    source: 'utilisateur',
  }));
  const deLaPlugins: CompetenceMachine[] = plugins
    .filter((p) => p.enabled && p.installPath)
    .flatMap((p) =>
      skillsDe(join(p.installPath ?? '', 'skills'), journal).map((c) => ({
        ...c,
        source: 'plugin' as const,
        plugin: p.id,
      })),
    );
  return [...utilisateur, ...deLaPlugins].sort((a, b) => a.nom.localeCompare(b.nom));
}

export type ResultatContenu =
  | { readonly ok: true; readonly contenu: string }
  | { readonly ok: false; readonly erreur: 'interdit' | 'lecture impossible' };

/** Contenu d'un SKILL.md : refusé (`interdit`) tant que le chemin ne correspond pas à une compétence listée. */
export function lireCompetence(
  dossierConfig: string,
  plugins: readonly PluginBrut[],
  chemin: string,
  journal: Logger,
): ResultatContenu {
  if (!listerCompetences(dossierConfig, plugins, journal).some((c) => c.chemin === chemin))
    return { ok: false, erreur: 'interdit' };
  try {
    return { ok: true, contenu: readFileSync(chemin, 'utf8') };
  } catch (erreur) {
    journal.error({ err: erreur, chemin }, 'lecture de la compétence impossible');
    return { ok: false, erreur: 'lecture impossible' };
  }
}

function skillsDe(dossier: string, journal: Logger): Trouvee[] {
  if (!existsSync(dossier)) return [];
  try {
    return readdirSync(dossier, { withFileTypes: true }).flatMap((entree) => {
      const chemin = join(dossier, entree.name, 'SKILL.md');
      return entree.isDirectory() && existsSync(chemin) ? [decrire(chemin, entree.name, journal)] : [];
    });
  } catch (erreur) {
    journal.warn({ err: erreur, dossier }, 'compétences illisibles');
    return [];
  }
}

function decrire(chemin: string, dossierNom: string, journal: Logger): Trouvee {
  try {
    const champs = lireFrontmatter(readFileSync(chemin, 'utf8'));
    return { nom: champs['name'] || dossierNom, description: champs['description'] ?? '', chemin };
  } catch (erreur) {
    journal.warn({ err: erreur, chemin }, 'SKILL.md illisible');
    return { nom: dossierNom, description: '', chemin };
  }
}
