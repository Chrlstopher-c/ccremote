// Responsabilité : trouver les transcripts Claude Code du poste (`<config>/projects/*/*.jsonl`) qu'aucune session
// connue ne couvre, et les décrire pour l'import. Lecture seule ; l'ajout à la liste est fait par le gestionnaire.
import { closeSync, existsSync, openSync, readSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import type { ResumeSession } from '../../commun/session.ts';
import type { Origine } from './adoption.ts';
import type { Logger } from 'pino';
import { titreDuTranscript } from './titre-transcript.ts';

export interface TranscriptImportable {
  readonly id: string;
  readonly cwd: string;
  readonly chemin: string;
  readonly configDir: string | null;
  readonly titre: string;
  readonly modifieLe: string;
}

const IDENTIFIANT = /^[A-Za-z0-9-]{1,100}$/;
const PREMIERS_OCTETS = 65_536;
export const IMPORTABLES_MAX = 100;

interface Candidat {
  readonly id: string;
  readonly chemin: string;
  readonly configDir: string | null;
  readonly mtime: number;
}

// Dossiers `projects` existants des configurations données (null = configuration par défaut de Claude Code).
export function dossiersProjets(configDirs: readonly (string | null)[]): string[] {
  const racines = new Set(configDirs.map((c) => join(c ?? join(homedir(), '.claude'), 'projects')));
  return [...racines].filter((d) => existsSync(d));
}

function candidats(configDirs: readonly (string | null)[], ecarte: (id: string) => boolean): Candidat[] {
  const trouves: Candidat[] = [];
  for (const projets of dossiersProjets(configDirs)) {
    for (const dossier of readdirSync(projets)) {
      const base = join(projets, dossier);
      for (const fichier of readdirSync(base)) {
        if (!fichier.endsWith('.jsonl')) continue;
        const id = fichier.slice(0, -'.jsonl'.length);
        if (!IDENTIFIANT.test(id) || ecarte(id)) continue;
        const chemin = join(base, fichier);
        const { size, mtimeMs } = statSync(chemin);
        if (size > 0) trouves.push({ id, chemin, configDir: configDirDe(projets), mtime: mtimeMs });
      }
    }
  }
  return trouves.sort((a, b) => b.mtime - a.mtime);
}

// Remonte de `<config>/projects` à la configuration qui le contient (null = défaut).
function configDirDe(projets: string): string | null {
  const config = dirname(projets);
  return config === join(homedir(), '.claude') ? null : config;
}

// Le dossier de travail est le champ `cwd` des premières lignes du transcript.
function cwdDuTranscript(chemin: string): string | null {
  const fd = openSync(chemin, 'r');
  try {
    const tampon = Buffer.alloc(PREMIERS_OCTETS);
    const lus = readSync(fd, tampon, 0, PREMIERS_OCTETS, 0);
    for (const ligne of tampon.subarray(0, lus).toString('utf8').split('\n')) {
      const cwd = cwdDeLigne(ligne);
      if (cwd) return cwd;
    }
    return null;
  } finally {
    closeSync(fd);
  }
}

function cwdDeLigne(ligne: string): string | null {
  if (!ligne.includes('"cwd"')) return null;
  try {
    const obj: unknown = JSON.parse(ligne);
    const cwd = typeof obj === 'object' && obj !== null && 'cwd' in obj ? (obj as { cwd: unknown }).cwd : null;
    return typeof cwd === 'string' && cwd.startsWith('/') ? cwd : null;
  } catch {
    return null;
  }
}

// `ecarte` : identifiants déjà connus du poste (sessions présentes, supprimées par Chris).
export function transcriptsImportables(
  configDirs: readonly (string | null)[],
  ecarte: (id: string) => boolean,
  journal: Logger,
): TranscriptImportable[] {
  const retenus: TranscriptImportable[] = [];
  for (const c of candidats(configDirs, ecarte)) {
    if (retenus.length >= IMPORTABLES_MAX) break;
    const cwd = cwdDuTranscript(c.chemin);
    if (!cwd) continue;
    const titre = titreDuTranscript(c.chemin, cwd, journal) ?? c.id;
    retenus.push({
      id: c.id,
      cwd,
      chemin: c.chemin,
      configDir: c.configDir,
      titre,
      modifieLe: new Date(c.mtime).toISOString(),
    });
  }
  return retenus;
}

export function ficheImportee(o: Origine, t: TranscriptImportable): ResumeSession {
  const maintenant = new Date().toISOString();
  return {
    id: t.id,
    machine: o.machine,
    projet: { machine: o.machine, chemin: t.cwd, nom: basename(t.cwd) },
    cwd: t.cwd,
    titre: t.titre,
    objectif: null,
    modele: 'défaut',
    compte: o.compte,
    autonomie: false,
    statut: 'fermee',
    contexte: { tokens: 0, max: o.fenetre },
    etapes: 0,
    compactions: 0,
    claudeSessionId: t.id,
    moteur: 'tmux',
    tmux: null,
    attachee: false,
    pilotee: false,
    creeLe: t.modifieLe,
    majLe: maintenant,
  };
}
