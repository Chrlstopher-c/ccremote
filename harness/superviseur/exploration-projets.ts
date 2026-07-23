/**
 * Responsabilité : laisser le control plane REGARDER l'arborescence des projets
 * qui vivent sur le PC.
 *
 * `☠` L'orchestrateur tourne sur le Pi ; les projets vivent sur le PC
 * (`/mnt/projects`). Il ne les voyait donc pas : `lister_projets` lisait le
 * répertoire local du Pi et rendait une liste vide, ce qui le faisait conclure
 * « aucun projet enregistré » alors que tout est là — constaté le 23/07.
 *
 * `☠` LECTURE SEULE et BORNÉE À UNE RACINE. Ce module ne rend jamais un chemin
 * hors de la racine configurée : un `..` dans la demande est résolu AVANT le
 * contrôle, jamais après. Sans cette garde, une requête du Pi pourrait faire
 * lister n'importe quel répertoire du PC — le lien est authentifié, mais un
 * chemin arbitraire reste une surface qu'on n'a aucune raison d'ouvrir.
 */

import { readdirSync, statSync, existsSync } from 'node:fs';
import { resolve, join, relative, isAbsolute } from 'node:path';
import { superviseurLogger } from './logger.ts';

const log = superviseurLogger.child({ composant: 'exploration-projets' });

/** Bornes : un listing doit rester lisible par un modèle, pas dumper un dépôt. */
const MAX_ENTREES = 200;

export interface EntreeProjet {
  readonly nom: string;
  readonly type: 'dossier' | 'fichier';
  /** Chemin ABSOLU sur le PC — celui qu'un worker recevra comme `cwd`. */
  readonly chemin: string;
  /** Vrai si le dossier contient un `.git` : c'est un projet, pas un simple répertoire. */
  readonly depotGit?: boolean;
}

export interface ResultatExploration {
  readonly racine: string;
  readonly chemin: string;
  readonly entrees: readonly EntreeProjet[];
  /** Renseigné quand la demande a été refusée ou tronquée. */
  readonly note?: string;
}

/**
 * Résout une demande DANS la racine. Rend `null` si elle s'en échappe.
 * `☠` La comparaison se fait sur le chemin RÉSOLU : comparer les chaînes brutes
 * laisserait passer `racine/../../etc`.
 */
export function resoudreDansRacine(racine: string, demande: string | undefined): string | null {
  const base = resolve(racine);
  if (demande === undefined || demande.trim().length === 0) return base;
  const cible = isAbsolute(demande) ? resolve(demande) : resolve(base, demande);
  const ecart = relative(base, cible);
  if (ecart.startsWith('..')) return null;
  return cible;
}

/** Liste un répertoire de projets. Ne lève jamais : une erreur d'accès devient une note. */
export function explorerProjets(racine: string, demande?: string): ResultatExploration {
  const base = resolve(racine);
  const cible = resoudreDansRacine(base, demande);
  if (cible === null) {
    return { racine: base, chemin: base, entrees: [], note: `chemin hors de ${base} — refusé` };
  }
  try {
    if (!existsSync(cible)) return { racine: base, chemin: cible, entrees: [], note: 'chemin inexistant sur le PC' };
    const noms = readdirSync(cible).filter((n) => !n.startsWith('.')).sort();
    const tronque = noms.length > MAX_ENTREES;
    const entrees: EntreeProjet[] = [];
    for (const nom of noms.slice(0, MAX_ENTREES)) {
      const chemin = join(cible, nom);
      try {
        const dossier = statSync(chemin).isDirectory();
        entrees.push({
          nom,
          type: dossier ? 'dossier' : 'fichier',
          chemin,
          ...(dossier ? { depotGit: existsSync(join(chemin, '.git')) } : {}),
        });
      } catch {
        // Entrée illisible (lien cassé, permissions) : on l'omet plutôt que
        // d'échouer sur tout le listing.
      }
    }
    return {
      racine: base,
      chemin: cible,
      entrees,
      ...(tronque ? { note: `${noms.length} entrées, ${MAX_ENTREES} rendues` } : {}),
    };
  } catch (erreur) {
    log.error({ err: erreur, cible }, 'exploration impossible');
    return { racine: base, chemin: cible, entrees: [], note: 'répertoire illisible sur le PC' };
  }
}
