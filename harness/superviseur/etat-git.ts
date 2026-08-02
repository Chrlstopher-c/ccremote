/**
 * Responsabilité : dire, depuis la MACHINE qui héberge une équipe, ce que son
 * dépôt contient de non commité au moment où elle rend la main.
 *
 * `☠ POURQUOI CE MODULE EXISTE` — « terminée » ne signifiait que « le lead a
 * fini de parler ». Une équipe qui rendait la main avec sept fichiers modifiés
 * et zéro commit était présentée exactement comme une équipe ayant livré : même
 * carte, même notification, même invitation à l'arrêter pour libérer le projet.
 * Le seul fait qui distingue les deux — l'état du dépôt — n'était mesuré nulle
 * part (relevé par l'orchestrateur lui-même, 02/08 : « une équipe peut rendre la
 * main sans avoir fini ni commité »).
 *
 * `☠` Le relevé vit ICI et pas sur le Pi : le dépôt est sur la machine de
 * travail, et le Pi n'a aucun accès à son disque (H-75). Il est PONCTUEL — à la
 * fin d'un tour, pas dans le balayage des 5 s : `git status` sur un gros dépôt
 * n'a rien à faire dans une boucle d'affichage.
 *
 * `☠` Ne lève JAMAIS et n'échoue jamais en silence : un dépôt illisible, un
 * `git` absent ou un timeout produisent un constat porteur de sa `note`. Un
 * constat vide serait lu comme « rien à signaler » — l'inverse de la vérité.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { superviseurLogger } from './logger.ts';

const execFileAsync = promisify(execFile);
const log = superviseurLogger.child({ composant: 'etat-git' });

/** Au-delà, on rend ce qu'on a avec une note : jamais d'attente indéfinie. */
const DELAI_MS = 5_000;

/** Combien de chemins on nomme dans l'aperçu — le compte total reste exact. */
const APERCU_MAX = 10;

export interface ConstatGit {
  /** `false` : ce chemin n'est pas un dépôt git — il n'y a rien à commiter. */
  readonly depot: boolean;
  readonly branche: string | null;
  /** Nombre de fichiers modifiés/ajoutés/supprimés non commités. */
  readonly fichiersModifies: number;
  /** Jusqu'à dix chemins, pour que le constat soit actionnable sans second appel. */
  readonly apercu: readonly string[];
  /** `"a1b2c3 · message"` du dernier commit, `null` si le dépôt n'en a aucun. */
  readonly dernierCommit: string | null;
  /** Horodatage du dernier commit (ms), pour situer « avant ou pendant la mission ». */
  readonly dernierCommitA: number | null;
  /** Ce qui a empêché un relevé complet. Absent quand tout a été lu. */
  readonly note?: string;
}

/** Constat neutre — utilisé quand rien ne peut être lu. `depot: false` ne ment pas. */
function indisponible(note: string): ConstatGit {
  return { depot: false, branche: null, fichiersModifies: 0, apercu: [], dernierCommit: null, dernierCommitA: null, note };
}

async function git(chemin: string, args: readonly string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', ['-C', chemin, ...args], {
    timeout: DELAI_MS,
    maxBuffer: 4 * 1024 * 1024,
  });
  return stdout.trim();
}

/**
 * Relève l'état du dépôt d'une équipe.
 *
 * `☠` L'ordre compte : on vérifie D'ABORD que le chemin est un dépôt. Lancer
 * `git status` dans un répertoire quelconque remonte le dépôt PARENT s'il y en
 * a un — le constat porterait alors sur un autre projet que celui de l'équipe.
 */
export async function releverEtatGit(chemin: string): Promise<ConstatGit> {
  try {
    const dedans = await git(chemin, ['rev-parse', '--is-inside-work-tree']);
    if (dedans !== 'true') return indisponible('ce chemin n’est pas un dépôt git');
  } catch (erreur) {
    log.debug({ err: erreur, chemin }, 'chemin non interrogeable par git — constat marqué indisponible');
    return indisponible(erreur instanceof Error ? erreur.message : String(erreur));
  }

  const constat: {
    branche: string | null;
    fichiersModifies: number;
    apercu: string[];
    dernierCommit: string | null;
    dernierCommitA: number | null;
    note?: string;
  } = { branche: null, fichiersModifies: 0, apercu: [], dernierCommit: null, dernierCommitA: null };

  try {
    // `☠` `branch --show-current` et non `rev-parse --abbrev-ref HEAD` : sur un
    // dépôt SANS AUCUN COMMIT, `rev-parse` échoue et la branche ressortait
    // `null` — précisément le cas le plus grave (tout le travail non commité),
    // celui où le constat doit être le plus complet.
    constat.branche = (await git(chemin, ['branch', '--show-current'])) || null;
  } catch {
    constat.branche = null;
  }

  try {
    const statut = await git(chemin, ['status', '--porcelain']);
    const lignes = statut === '' ? [] : statut.split('\n');
    constat.fichiersModifies = lignes.length;
    constat.apercu = lignes.slice(0, APERCU_MAX).map((l) => l.slice(3).trim());
  } catch (erreur) {
    // `☠` Un statut illisible n'autorise PAS à conclure « propre ». On le dit.
    constat.note = `état du dépôt illisible : ${erreur instanceof Error ? erreur.message : String(erreur)}`;
  }

  try {
    // `☠` Séparateur = saut de ligne (`%n`), et le SUJET est lu en dernier via
    // `slice(2).join()` : un message de commit peut contenir n'importe quel
    // caractère, y compris celui qu'on aurait choisi comme séparateur.
    const brut = await git(chemin, ['log', '-1', '--format=%h%n%ct%n%s']);
    const [hash, horodatage, ...reste] = brut.split('\n');
    if (hash !== undefined && hash !== '') {
      const sujet = reste.join(' ').trim();
      constat.dernierCommit = sujet === '' ? hash : `${hash} · ${sujet}`;
      const secondes = Number(horodatage);
      constat.dernierCommitA = Number.isFinite(secondes) ? secondes * 1000 : null;
    }
  } catch {
    // Dépôt sans aucun commit : légitime, pas une anomalie.
    constat.dernierCommit = null;
  }

  return {
    depot: true,
    branche: constat.branche,
    fichiersModifies: constat.fichiersModifies,
    apercu: constat.apercu,
    dernierCommit: constat.dernierCommit,
    dernierCommitA: constat.dernierCommitA,
    ...(constat.note === undefined ? {} : { note: constat.note }),
  };
}

/**
 * Résumé d'une ligne, destiné à un humain comme à l'orchestrateur.
 *
 * `☠` Dit toujours quelque chose, y compris « rien à signaler » : une chaîne
 * vide serait indistinguable d'un relevé qui n'a pas eu lieu.
 */
export function resumerConstatGit(constat: ConstatGit): string {
  if (!constat.depot) return `état git indisponible${constat.note === undefined ? '' : ` (${constat.note})`}`;
  const branche = constat.branche === null ? 'branche inconnue' : `branche ${constat.branche}`;
  if (constat.fichiersModifies === 0) {
    return `${branche} · aucun fichier non commité` + (constat.dernierCommit === null ? '' : ` · dernier commit ${constat.dernierCommit}`);
  }
  const exemples = constat.apercu.slice(0, 3).join(', ');
  return (
    `${branche} · ${constat.fichiersModifies} fichier(s) NON COMMITÉ(S)` +
    (exemples === '' ? '' : ` (${exemples}${constat.fichiersModifies > 3 ? '…' : ''})`) +
    (constat.dernierCommit === null ? ' · aucun commit dans ce dépôt' : ` · dernier commit ${constat.dernierCommit}`)
  );
}
