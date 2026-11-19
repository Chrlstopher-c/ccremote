// Responsabilité : l'index des transcripts Claude Code du poste (`<config>/projects/<dossier>/<id>.jsonl`), relu
// seulement quand un fichier change (mtime + taille), surveillé pour les nouvelles sessions. Lecture seule sur les
// transcripts de Chris ; le cache vit dans les données de Lanterne, jamais dans ~/.claude.
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, watch, writeFileSync } from 'node:fs';
import type { FSWatcher } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import type { Logger } from 'pino';
import type { Decouverte } from '../../commun/decouverte.ts';
import { titreDeContenu, titreDuMessage } from './titre-transcript.ts';

export interface TranscriptDecouvert extends Decouverte {
  readonly chemin: string;
  readonly configDir: string | null;
}

interface Analyse {
  readonly cwd: string | null;
  readonly branche: string | null;
  readonly messages: number;
  readonly sousAgent: boolean;
  readonly aMessageDeChris: boolean;
}

interface EntreeCache {
  readonly mtime: number;
  readonly taille: number;
  readonly transcript: TranscriptDecouvert | null;
}

export interface OptionsIndex {
  readonly machine: string;
  readonly configDirs: () => readonly (string | null)[];
  readonly fichierCache: string;
  readonly journal: Logger;
  readonly surChangement: () => void;
}

const IDENTIFIANT = /^[A-Za-z0-9-]{1,100}$/;
const PERIODE_SECOURS_MS = 60_000; // balayage complet si une surveillance rate un événement
const DELAI_SURVEILLANCE_MS = 3_000; // une session active écrit en continu : on regroupe les événements

// Dossiers `projects` des configurations données (null = configuration par défaut), existants seulement.
export function dossiersProjets(configDirs: readonly (string | null)[]): string[] {
  const racines = new Set(configDirs.map((c) => join(c ?? join(homedir(), '.claude'), 'projects')));
  return [...racines].filter((d) => existsSync(d));
}

const enObjet = (v: unknown): Record<string, unknown> | null =>
  typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

/** Lit un transcript en une passe : dossier de travail, branche, nombre de messages, sous-agent ou non. */
export function analyserTranscript(contenu: string): Analyse {
  let cwd: string | null = null;
  let branche: string | null = null;
  let messages = 0;
  let sousAgent: boolean | null = null;
  let aMessageDeChris = false;
  for (const ligne of contenu.split('\n')) {
    if (!ligne) continue;
    if (ligne.includes('"type":"user"') || ligne.includes('"type":"assistant"')) messages++;
    if (sousAgent === null && ligne.includes('"isSidechain"')) sousAgent = ligne.includes('"isSidechain":true');
    if (cwd !== null && branche !== null && aMessageDeChris) continue;
    const objet = parserLigne(ligne);
    if (!objet) continue;
    if (cwd === null && typeof objet['cwd'] === 'string' && objet['cwd'].startsWith('/')) cwd = objet['cwd'];
    if (branche === null && typeof objet['gitBranch'] === 'string' && objet['gitBranch'] !== '') {
      branche = objet['gitBranch'];
    }
    if (!aMessageDeChris && objet['type'] === 'user' && titreDuMessage(objet) !== null) aMessageDeChris = true;
  }
  return { cwd, branche, messages, sousAgent: sousAgent === true, aMessageDeChris };
}

function parserLigne(ligne: string): Record<string, unknown> | null {
  try {
    return enObjet(JSON.parse(ligne));
  } catch {
    return null; // ligne tronquée (écriture en cours) : ignorée
  }
}

// Une session exclue (sous-agent, vide, sans message de Chris, sans dossier) : pas d'entrée.
function transcriptDe(
  analyse: Analyse,
  contenu: string,
  base: { id: string; chemin: string; configDir: string | null; mtime: number },
  machine: string,
): TranscriptDecouvert | null {
  if (!IDENTIFIANT.test(base.id) || analyse.sousAgent || !analyse.aMessageDeChris || !analyse.cwd) return null;
  const titre = titreDeContenu(contenu, analyse.cwd) ?? basename(analyse.cwd);
  return {
    id: base.id,
    machine,
    cwd: analyse.cwd,
    titre,
    modifieLe: new Date(base.mtime).toISOString(),
    branche: analyse.branche,
    messages: analyse.messages,
    chemin: base.chemin,
    configDir: base.configDir,
  };
}

export class IndexDecouvertes {
  private entrees = new Map<string, EntreeCache>();
  private veilles = new Map<string, FSWatcher>();
  private delai: ReturnType<typeof setTimeout> | null = null;
  private secours: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly options: OptionsIndex) {}

  demarrer(): void {
    this.charger();
    this.rafraichir();
    this.surveiller();
    this.secours = setInterval(() => this.rafraichir(), PERIODE_SECOURS_MS);
  }

  arreter(): void {
    if (this.secours) clearInterval(this.secours);
    if (this.delai) clearTimeout(this.delai);
    for (const w of this.veilles.values()) w.close();
    this.veilles.clear();
  }

  /** Sessions trouvées sur le poste, la plus récente d'abord, hors identifiants écartés (fiches connues). */
  liste(ecarte: (id: string) => boolean): TranscriptDecouvert[] {
    const parId = new Map<string, TranscriptDecouvert>();
    for (const e of this.entrees.values()) {
      const t = e.transcript;
      if (!t || ecarte(t.id)) continue;
      // Même identifiant dans deux dossiers (copie ssh-) : une seule session, la plus récente.
      const deja = parId.get(t.id);
      if (!deja || deja.modifieLe < t.modifieLe) parId.set(t.id, t);
    }
    return [...parId.values()].sort((a, b) => b.modifieLe.localeCompare(a.modifieLe));
  }

  /** Relit les seuls transcripts nouveaux ou modifiés ; true si l'index a bougé. */
  rafraichir(): boolean {
    let change = false;
    const vus = new Set<string>();
    for (const base of dossiersProjets(this.options.configDirs())) {
      for (const dossier of this.sousDossiers(base)) {
        for (const fichier of this.fichiersJsonl(dossier)) {
          const chemin = join(dossier, fichier);
          vus.add(chemin);
          change = this.traiterFichier(chemin, fichier, base) || change;
        }
      }
    }
    for (const chemin of [...this.entrees.keys()]) {
      if (!vus.has(chemin)) {
        this.entrees.delete(chemin);
        change = true;
      }
    }
    this.surveiller();
    if (change) {
      this.sauvegarder();
      this.options.surChangement();
    }
    return change;
  }

  private traiterFichier(chemin: string, fichier: string, projets: string): boolean {
    let etat: { mtimeMs: number; size: number };
    try {
      etat = statSync(chemin);
    } catch {
      return false; // disparu entre le listage et le contrôle
    }
    const cache = this.entrees.get(chemin);
    if (cache && cache.mtime === etat.mtimeMs && cache.taille === etat.size) return false;
    const id = fichier.slice(0, -'.jsonl'.length);
    const transcript = this.lireEntree(chemin, id, projets, etat.mtimeMs, etat.size);
    this.entrees.set(chemin, { mtime: etat.mtimeMs, taille: etat.size, transcript });
    return true;
  }

  private lireEntree(
    chemin: string,
    id: string,
    projets: string,
    mtime: number,
    taille: number,
  ): TranscriptDecouvert | null {
    if (taille === 0 || id.startsWith('agent-')) return null;
    let contenu: string;
    try {
      contenu = readFileSync(chemin, 'utf8');
    } catch (erreur) {
      this.options.journal.warn({ chemin, err: erreur }, 'transcript illisible : ignoré');
      return null;
    }
    const configDir = dirname(projets) === join(homedir(), '.claude') ? null : dirname(projets);
    return transcriptDe(analyserTranscript(contenu), contenu, { id, chemin, configDir, mtime }, this.options.machine);
  }

  private sousDossiers(base: string): string[] {
    try {
      return readdirSync(base, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => join(base, e.name));
    } catch {
      return [];
    }
  }

  private fichiersJsonl(dossier: string): string[] {
    try {
      return readdirSync(dossier).filter((f) => f.endsWith('.jsonl'));
    } catch {
      return [];
    }
  }

  // Une surveillance par dossier de projet : une session lancée dans un terminal fait bouger son dossier.
  private surveiller(): void {
    const voulus = new Set<string>();
    for (const base of dossiersProjets(this.options.configDirs())) {
      voulus.add(base);
      for (const dossier of this.sousDossiers(base)) voulus.add(dossier);
    }
    for (const [dossier, w] of this.veilles) {
      if (!voulus.has(dossier)) {
        w.close();
        this.veilles.delete(dossier);
      }
    }
    for (const dossier of voulus) {
      if (this.veilles.has(dossier)) continue;
      try {
        this.veilles.set(dossier, watch(dossier, () => this.planifier()));
      } catch (erreur) {
        this.options.journal.warn({ err: erreur, dossier }, 'surveillance impossible : balayage périodique seulement');
      }
    }
  }

  private planifier(): void {
    if (this.delai) return;
    this.delai = setTimeout(() => {
      this.delai = null;
      this.rafraichir();
    }, DELAI_SURVEILLANCE_MS);
  }

  private charger(): void {
    try {
      const brut = JSON.parse(readFileSync(this.options.fichierCache, 'utf8')) as {
        entrees?: Record<string, EntreeCache>;
      };
      this.entrees = new Map(Object.entries(brut.entrees ?? {}));
    } catch {
      this.entrees = new Map(); // pas de cache (premier démarrage) : rien à perdre, on relit tout
    }
  }

  private sauvegarder(): void {
    const fichier = this.options.fichierCache;
    try {
      mkdirSync(dirname(fichier), { recursive: true });
      const temp = `${fichier}.tmp`;
      writeFileSync(temp, JSON.stringify({ entrees: Object.fromEntries(this.entrees) }));
      renameSync(temp, fichier);
    } catch (erreur) {
      this.options.journal.error({ err: erreur, fichier }, 'cache des sessions découvertes non écrit');
    }
  }
}
