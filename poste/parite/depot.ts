// Responsabilité : le dépôt de travail d'une session — racine git de son dossier, sinon celle que désignent ses
// derniers appels d'outil ; branche, `propriétaire/dépôt` GitHub, dernière demande de fusion. Git par tableaux
// d'arguments (jamais de shell), délai borné, résultats gardés 30 s.
import { existsSync, statSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Logger } from 'pino';
import type { DepotTravail } from '../../commun/parite.ts';
import type { EtatTranscript, PrVue } from './etat.ts';
import { lireEtat } from './lecture.ts';
import { lancerProgramme } from '../reste/processus.ts';

const DELAI_GIT_MS = 5_000;
const DUREE_CACHE_MS = 30_000;
const GITHUB = /github\.com[:/]([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/;

const cacheGit = new Map<string, { readonly quand: number; readonly valeur: string | null }>();

/** Vide le cache git (tests). */
export function oublierDepots(): void {
  cacheGit.clear();
}

/** Sortie de `git -C dossier args`, sans fin de ligne ; null si git échoue, est absent ou ne répond pas. */
async function gitSortie(dossier: string, args: readonly string[], journal: Logger): Promise<string | null> {
  if (!existsSync(dossier)) return null;
  const cle = `${dossier}\u0000${args.join(' ')}`;
  const memo = cacheGit.get(cle);
  if (memo && Date.now() - memo.quand < DUREE_CACHE_MS) return memo.valeur;
  const r = await lancerProgramme(['git', '-C', dossier, ...args], dossier, DELAI_GIT_MS, journal);
  const valeur = !r.absent && r.code === 0 && r.sortie !== '' ? r.sortie : null;
  cacheGit.set(cle, { quand: Date.now(), valeur });
  return valeur;
}

export async function racineGit(dossier: string, journal: Logger): Promise<string | null> {
  return gitSortie(dossier, ['rev-parse', '--show-toplevel'], journal);
}

async function brancheDe(racine: string, journal: Logger): Promise<string | null> {
  const nom = await gitSortie(racine, ['rev-parse', '--abbrev-ref', 'HEAD'], journal);
  return nom === null || nom === 'HEAD' ? null : nom;
}

async function depotDe(racine: string, journal: Logger): Promise<string | null> {
  const url = await gitSortie(racine, ['remote', 'get-url', 'origin'], journal);
  const m = url === null ? null : GITHUB.exec(url);
  return m?.[1] && m[2] ? `${m[1]}/${m[2]}` : null;
}

/** Le dossier candidat d'un chemin cité : le chemin s'il est un dossier, sinon son parent ; null s'il n'existe pas. */
function dossierCandidat(chemin: string): string | null {
  if (!existsSync(chemin)) return existsSync(dirname(chemin)) ? dirname(chemin) : null;
  return statSync(chemin).isDirectory() ? chemin : dirname(chemin);
}

/** La racine la plus citée par les derniers appels d'outil (à égalité, la plus récente), ou null. */
export async function racineDepuisTranscript(etat: EtatTranscript, journal: Logger): Promise<string | null> {
  const compte = new Map<string, { n: number; premier: number }>();
  let rang = 0;
  for (const indices of [...etat.indices].reverse()) {
    for (const chemin of indices) {
      rang += 1;
      const dossier = dossierCandidat(chemin);
      const racine = dossier === null ? null : await racineGit(dossier, journal);
      if (racine === null) continue;
      const vu = compte.get(racine);
      if (vu) vu.n += 1;
      else compte.set(racine, { n: 1, premier: rang });
    }
  }
  const choisie = [...compte.entries()].sort(([, a], [, b]) => b.n - a.n || a.premier - b.premier)[0];
  return choisie?.[0] ?? null;
}

/** Le dépôt de travail de la session : racine de son dossier, sinon déduite de son transcript. null sans dépôt. */
export async function depotDeTravail(cwd: string, etat: EtatTranscript, journal: Logger): Promise<DepotTravail | null> {
  let racine = await racineGit(cwd, journal);
  let source: DepotTravail['source'] = 'dossier';
  if (racine === null) {
    racine = await racineDepuisTranscript(etat, journal);
    source = 'transcript';
  }
  if (racine === null) return null;
  const depot = await depotDe(racine, journal);
  return {
    racine,
    branche: await brancheDe(racine, journal),
    depot,
    source,
    pr: prPour(etat, depot),
  };
}

function prPour(etat: EtatTranscript, depot: string | null): PrVue | null {
  if (depot === null) return etat.dernierePr;
  return etat.prs.get(depot) ?? null;
}

/**
 * Le dossier où agir sur git pour une session : son cwd s'il est dans un dépôt, sinon la racine déduite de son
 * transcript (si elle existe), sinon le cwd tel quel.
 */
export async function dossierDeTravail(cwd: string, transcript: string | null, journal: Logger): Promise<string> {
  if ((await racineGit(cwd, journal)) !== null) return cwd;
  if (transcript === null) return cwd;
  const etat = lireEtat(transcript, journal);
  if (etat === null) return cwd;
  return (await racineDepuisTranscript(etat, journal)) ?? cwd;
}
