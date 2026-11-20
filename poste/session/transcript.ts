// Responsabilité : lire un transcript JSONL de Claude Code au fil de l'eau, et retrouver celui d'une session tmux.
import { closeSync, existsSync, openSync, readdirSync, readFileSync, readSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Ligne } from './traduction.ts';

export function dossierTranscripts(dossier: string, configDir: string | null): string {
  return join(configDir ?? join(homedir(), '.claude'), 'projects', dossier.replace(/[^A-Za-z0-9]/g, '-'));
}

export function cheminTranscript(dossier: string, sessionId: string, configDir: string | null): string {
  return join(dossierTranscripts(dossier, configDir), `${sessionId}.jsonl`);
}

export class LecteurTranscript {
  private reste: Buffer = Buffer.alloc(0); // octets d'une ligne incomplète (un caractère UTF-8 peut y être coupé)

  constructor(
    readonly chemin: string,
    private position = 0,
  ) {}

  get lu(): number {
    return this.position;
  }

  // Lignes complètes ajoutées depuis la dernière lecture ; une ligne en cours d'écriture attend la suivante.
  lire(): Ligne[] {
    if (!existsSync(this.chemin)) return [];
    const taille = statSync(this.chemin).size;
    if (taille < this.position) this.position = 0; // fichier réécrit : on repart du début
    if (taille === this.position) return [];
    const tampon = Buffer.alloc(taille - this.position);
    const fd = openSync(this.chemin, 'r');
    try {
      readSync(fd, tampon, 0, tampon.length, this.position);
    } finally {
      closeSync(fd);
    }
    this.position = taille;
    const tout = Buffer.concat([this.reste, tampon]);
    const fin = tout.lastIndexOf(0x0a);
    this.reste = tout.subarray(fin + 1);
    if (fin < 0) return [];
    return tout
      .subarray(0, fin)
      .toString('utf8')
      .split('\n')
      .flatMap((l) => {
        try {
          return l ? [JSON.parse(l) as Ligne] : [];
        } catch {
          return []; // ligne corrompue : ignorée, le transcript reste lisible au-delà
        }
      });
  }
}

interface Candidat {
  readonly id: string;
  readonly chemin: string;
  readonly date: number;
}

function candidats(dossier: string, configDir: string | null): Candidat[] {
  const base = dossierTranscripts(dossier, configDir);
  if (!existsSync(base)) return [];
  return readdirSync(base)
    .filter((f) => f.endsWith('.jsonl'))
    .map((f) => ({ id: f.slice(0, -6), chemin: join(base, f), date: statSync(join(base, f)).mtimeMs }))
    .sort((a, b) => b.date - a.date);
}

// Session tmux lancée hors ccremote : sa conversation se retrouve par son nom (/rename), sinon par le transcript
// le plus récent, seulement s'il n'y a aucune ambiguïté (un seul Claude dans ce dossier).
export function retrouverTranscript(
  dossier: string,
  titre: string,
  voisins: number,
  configDir: string | null,
): Candidat | null {
  const liste = candidats(dossier, configDir);
  const motif = `"customTitle":${JSON.stringify(titre)}`;
  const parNom = liste.find((c) => readFileSync(c.chemin, 'utf8').includes(motif));
  if (parNom) return parNom;
  return voisins === 1 ? (liste[0] ?? null) : null;
}
