/**
 * Responsabilité : chercher un motif DANS le contenu des projets du PC, et
 * rendre un résultat borné, lisible par un modèle.
 *
 * `☠` Le chaînon qui manquait à l'orchestrateur pour cadrer un mandat. Il
 * pouvait lister une arborescence (`exploration-projets.ts`) et lire un fichier
 * qu'il savait déjà nommer (`lecture-fichier.ts`) — mais pas TROUVER. Sur un
 * dépôt inconnu, ça revenait à chercher une aiguille en ouvrant les fichiers un
 * par un, ce qui sature son contexte avant d'avoir trouvé quoi que ce soit. Une
 * équipe lancée sur un cadrage aveugle coûte bien plus cher que cette recherche.
 *
 * `☠` MÊME CONFINEMENT que l'exploration, et par la MÊME fonction
 * (`resoudreDansRacine`) : une règle de sécurité recopiée ne se corrige qu'à
 * moitié le jour où elle est fausse.
 *
 * `☠` Le motif est passé à `rg` en ARGUMENT, jamais concaténé dans un shell.
 * `Bun.spawn` avec un tableau d'arguments n'ouvre pas de shell : un motif
 * contenant `;` ou `$(…)` est cherché littéralement, pas exécuté. C'est la
 * seule raison pour laquelle laisser un modèle composer ce motif est acceptable
 * — sa sortie est une entrée utilisateur comme une autre.
 */

import { resolve } from 'node:path';
import { resoudreDansRacine } from './exploration-projets.ts';
import { superviseurLogger } from './logger.ts';

const log = superviseurLogger.child({ composant: 'recherche-projets' });

/**
 * Bornes. `☠` Elles servent le CONTEXTE de l'orchestrateur autant que le PC :
 * cent occurrences ne l'aident pas à décider mieux que vingt, elles le
 * rapprochent juste d'une compaction — et un orchestrateur qui compacte oublie
 * ce qu'il cherchait.
 */
export const RECHERCHE_MAX_RESULTATS = 40;
export const RECHERCHE_MAX_LONGUEUR_LIGNE = 240;
const RECHERCHE_TIMEOUT_MS = 20_000;

/**
 * Répertoires qu'on ne fouille jamais.
 *
 * `☠` Sans eux, un motif introuvable fait scanner tous les `node_modules` de
 * tous les projets, dépasse le timeout et rend une erreur — mesuré au premier
 * essai réel : « aucune occurrence » devenait « recherche impossible ». Ce n'est
 * pas une optimisation, c'est ce qui fait la différence entre un outil utilisable
 * et un outil qui échoue exactement quand la réponse est « rien ».
 *
 * `☠` `.git` est exclu aussi : chercher dans les objets d'un dépôt ne rend que
 * du binaire et coûte le plus gros du temps de scan.
 */
const EXCLUSIONS = [
  '!node_modules',
  '!.git',
  '!venv',
  '!.venv',
  '!__pycache__',
  '!dist',
  '!build',
  '!target',
  '!.next',
  '!*.lock',
  '!*.min.js',
] as const;

export interface OccurrenceRecherche {
  /** Chemin relatif à la racine — absolu, il noierait la lecture pour rien. */
  readonly fichier: string;
  readonly ligne: number;
  readonly texte: string;
}

export interface ResultatRecherche {
  readonly motif: string;
  readonly chemin: string;
  readonly occurrences: readonly OccurrenceRecherche[];
  /** Renseignée dès que le résultat est partiel, refusé ou vide pour une raison précise. */
  readonly note?: string;
  /**
   * `☠` LA DIFFÉRENCE ENTRE « RIEN TROUVÉ » ET « JE N'AI PAS CHERCHÉ » (03/08).
   * Un échec rendait exactement la même forme qu'une recherche fructueuse mais
   * vide — `occurrences: []` plus une note — et l'orchestrateur l'a dit lui-même
   * après le test des outils : « un cadrage naïf conclurait *rien trouvé* au lieu
   * de *outil HS* ». Ce drapeau est là pour qu'aucune lecture pressée ne puisse
   * confondre les deux.
   */
  readonly echec?: true;
}

function refus(motif: string, chemin: string, note: string): ResultatRecherche {
  return { motif, chemin, occurrences: [], note, echec: true };
}

/**
 * `☠` Une ligne de code minifiée ou un fichier de données sur une seule ligne
 * remplirait le contexte à lui seul. On tronque au caractère près plutôt que
 * d'écarter le fichier : l'information « ça matche ici » vaut le coup, pas les
 * 400 Ko qui l'accompagnent.
 */
function tronquer(ligne: string): string {
  const propre = ligne.replace(/\s+$/, '');
  return propre.length > RECHERCHE_MAX_LONGUEUR_LIGNE
    ? `${propre.slice(0, RECHERCHE_MAX_LONGUEUR_LIGNE)}…`
    : propre;
}

/** Parse une ligne `chemin:numéro:texte` de ripgrep. `null` si illisible. */
function parserLigne(brut: string, base: string): OccurrenceRecherche | null {
  // `☠` Découpage sur les DEUX premiers `:` seulement : un chemin Windows ou un
  // texte contenant des `:` casserait un `split(':')` naïf, et les occurrences
  // les plus intéressantes (URLs, types TS) en contiennent presque toujours.
  const premier = brut.indexOf(':');
  if (premier < 0) return null;
  const second = brut.indexOf(':', premier + 1);
  if (second < 0) return null;
  const ligne = Number.parseInt(brut.slice(premier + 1, second), 10);
  if (!Number.isFinite(ligne)) return null;
  const fichier = brut.slice(0, premier);
  return {
    fichier: fichier.startsWith(base) ? fichier.slice(base.length).replace(/^\//, '') : fichier,
    ligne,
    texte: tronquer(brut.slice(second + 1)),
  };
}

/**
 * Le moteur réellement disponible sur CETTE machine.
 *
 * `☠` `rg` n'est pas installé partout : présent sur le PC, absent du VPS et du Pi
 * (mesuré le 03/08). `Bun.spawn` lève alors « Executable not found in $PATH »,
 * l'exception devenait une note, et l'outil rendait une liste vide — le mode de
 * panne exact que l'orchestrateur a relevé. Le repli `grep` n'est pas un luxe :
 * il fait que la capacité ne dépend plus d'un paquet optionnel.
 */
async function moteurDisponible(): Promise<'rg' | 'grep' | null> {
  for (const binaire of ['rg', 'grep'] as const) {
    try {
      const proc = Bun.spawn([binaire, '--version'], { stdout: 'ignore', stderr: 'ignore' });
      if ((await proc.exited) === 0) return binaire;
    } catch {
      // Binaire absent : on essaie le suivant, c'est tout le propos de cette boucle.
    }
  }
  return null;
}

/** Arguments de `rg` — le moteur préféré : exclusions natives, `--smart-case`. */
function argsRg(aiguille: string, cible: string): string[] {
  return [
    'rg',
    '--line-number',
    '--no-heading',
    '--color=never',
    '--max-count=3',
    '--max-filesize=2M',
    `--max-columns=${RECHERCHE_MAX_LONGUEUR_LIGNE * 2}`,
    '--smart-case',
    ...EXCLUSIONS.flatMap((g) => ['--glob', g]),
    '--',
    aiguille,
    cible,
  ];
}

/**
 * Arguments du repli `grep`. `☠` `-I` (binaires ignorés) et les `--exclude-dir`
 * ne sont pas cosmétiques : sans eux, le repli scanne `node_modules` et `.git`,
 * dépasse le timeout, et se comporte exactement comme la panne qu'il répare.
 * `-E` pour que le même motif marche des deux côtés — `rg` est en regex par défaut.
 */
function argsGrep(aiguille: string, cible: string): string[] {
  const dossiers = EXCLUSIONS.filter((g) => !g.includes('*')).map((g) => `--exclude-dir=${g.slice(1)}`);
  const fichiers = EXCLUSIONS.filter((g) => g.includes('*')).map((g) => `--exclude=${g.slice(1)}`);
  return ['grep', '-rInE', '--binary-files=without-match', ...dossiers, ...fichiers, '--', aiguille, cible];
}

/**
 * Cherche `motif` sous `racine` (ou sous `chemin` s'il est fourni et confiné).
 * Ne lève jamais : toute erreur devient une `note`.
 */
export async function rechercherDansProjets(
  racine: string,
  motif: string,
  /** Projet où chercher. REQUIS — voir la garde en tête de fonction. */
  chemin?: string,
  maxResultats: number = RECHERCHE_MAX_RESULTATS,
): Promise<ResultatRecherche> {
  const base = resolve(racine);
  const aiguille = motif.trim();
  if (aiguille.length === 0) return refus(motif, base, 'motif vide — rien à chercher');

  // `☠` Un PROJET est exigé, jamais la racine entière. MESURÉ le 01/08, chrono
  // en main : `rg` sur `/mnt/projects` (248 Go, 74 projets) met **21 min 55 s**,
  // node_modules et .git déjà exclus. Et c'est de l'I/O, pas du calcul —
  // 4,8 s de CPU utilisateur pour 22 min de temps réel : aucune optimisation de
  // motif n'y changera quoi que ce soit. Une
  // recherche globale n'échouerait pas franchement, elle rendrait un timeout,
  // c'est-à-dire le pire des résultats : ni réponse, ni refus compréhensible.
  // Autoriser un défaut « toute la racine » aurait fait de l'outil une déception
  // systématique à son premier usage naturel.
  if (chemin === undefined || chemin.trim().length === 0) {
    return refus(
      aiguille,
      base,
      'précise le projet où chercher (`chemin`) : la racine entière est trop vaste pour ' +
        'être fouillée. Utilise `explorer_projets` si tu ne sais pas encore lequel.',
    );
  }

  const cible = resoudreDansRacine(base, chemin);
  if (cible === null) {
    return refus(aiguille, base, `chemin hors du répertoire de projets — refusé (racine : ${base})`);
  }

  const plafond = Math.min(Math.max(Math.trunc(maxResultats), 1), RECHERCHE_MAX_RESULTATS);

  const moteur = await moteurDisponible();
  if (moteur === null) {
    return refus(
      aiguille,
      cible,
      'ÉCHEC DE L’OUTIL, pas un résultat vide : ni ripgrep (`rg`) ni `grep` ne sont installés sur ' +
        'la machine qui porte ce projet. Ne conclus rien sur le contenu du dépôt — fais installer ' +
        'ripgrep, ou passe par une équipe qui a le shell.',
    );
  }

  try {
    const proc = Bun.spawn(moteur === 'rg' ? argsRg(aiguille, cible) : argsGrep(aiguille, cible), {
      stdout: 'pipe',
      stderr: 'pipe',
    });

    // `☠` Timeout OBLIGATOIRE : une recherche sur un dépôt monstrueux bloquerait
    // le canal de contrôle, donc TOUT le pilotage du parc, pour une commodité.
    let expire = false;
    const minuterie = setTimeout(() => {
      expire = true;
      proc.kill();
    }, RECHERCHE_TIMEOUT_MS);
    const sortie = await new Response(proc.stdout).text();
    const code = await proc.exited;
    clearTimeout(minuterie);

    // `☠` Le timeout se dit COMME TEL, avec la manœuvre à faire. Il était
    // confondu avec une panne : le message accusait ripgrep d'être absent alors
    // que c'est nous qui venions de le tuer, et l'orchestrateur en aurait conclu
    // que la recherche n'existe pas sur ce déploiement (mesuré au premier essai
    // réel, 01/08).
    if (expire) {
      return refus(
        aiguille,
        cible,
        `recherche interrompue après ${RECHERCHE_TIMEOUT_MS / 1000} s — trop large. ` +
          'Restreins avec `chemin` (un projet plutôt que la racine) ou affine le motif.',
      );
    }

    // `rg` comme `grep` rendent 1 quand ils ne trouvent rien : ce n'est pas une erreur.
    if (code !== 0 && code !== 1 && sortie.length === 0) {
      const err = await new Response(proc.stderr).text();
      return refus(
        aiguille,
        cible,
        `ÉCHEC DE L’OUTIL (${moteur}, code ${code}) — aucune conclusion à tirer sur le dépôt : ` +
          `${err.slice(0, 200) || 'sortie d’erreur vide'}`,
      );
    }

    const brutes = sortie.split('\n').filter((l) => l.length > 0);
    const occurrences: OccurrenceRecherche[] = [];
    for (const l of brutes) {
      if (occurrences.length >= plafond) break;
      const o = parserLigne(l, base);
      if (o !== null) occurrences.push(o);
    }

    const tronque = brutes.length > occurrences.length;
    return {
      motif: aiguille,
      chemin: cible,
      occurrences,
      // `☠` « Aucune occurrence » dit maintenant AVEC QUOI on a cherché : c'est ce
      // qui permet de distinguer une absence réelle d'une recherche dégradée.
      ...(occurrences.length === 0
        ? { note: `aucune occurrence (recherche réellement effectuée, moteur ${moteur})` }
        : tronque
          ? { note: `${occurrences.length} occurrences affichées sur ${brutes.length} trouvées — affine le motif` }
          : {}),
    };
  } catch (erreur) {
    log.error({ err: erreur, motif: aiguille }, 'recherche dans les projets en échec');
    return refus(
      aiguille,
      cible,
      `ÉCHEC DE L’OUTIL — aucune conclusion à tirer sur le dépôt : ${erreur instanceof Error ? erreur.message : String(erreur)}`,
    );
  }
}
