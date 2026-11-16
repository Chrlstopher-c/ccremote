// Responsabilité : les processus Claude Code vivants de la machine, tels que Claude les déclare lui-même dans
// `<config>/sessions/<pid>.json` (identifiant de session exact, dossier, type). Sert à relier une session tmux à sa
// conversation sans deviner, et à voir les sessions lancées hors tmux (terminal ordinaire).
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Logger } from 'pino';
import { z } from 'zod';

const Declaration = z.object({
  pid: z.number(),
  sessionId: z.string(),
  cwd: z.string(),
  kind: z.string().optional(),
  entrypoint: z.string().optional(),
  name: z.string().optional(),
});

export interface ProcessusClaude {
  readonly pid: number;
  readonly sessionId: string;
  readonly cwd: string;
  readonly enTmux: boolean;
  readonly configDir: string | null;
  readonly nom: string | null; // nom donné par Claude (/rename, --name) dans son registre natif
}

function lire(chemin: string): string {
  try {
    return readFileSync(chemin, 'utf8');
  } catch {
    return ''; // processus terminé entre la liste et la lecture : ignoré
  }
}

// Une déclaration tronquée (écriture interrompue, processus tué) ne doit pas bloquer la lecture des autres.
function declaration(chemin: string, journal: Logger): unknown {
  try {
    return JSON.parse(lire(chemin) || 'null');
  } catch (erreur) {
    journal.warn({ fichier: chemin, err: erreur }, 'déclaration de session illisible, ignorée');
    return null;
  }
}

function vivant(pid: number): boolean {
  return existsSync(`/proc/${pid}`) && lire(`/proc/${pid}/comm`).trim() === 'claude';
}

function enTmux(pid: number): boolean {
  return lire(`/proc/${pid}/environ`)
    .split('\0')
    .some((v) => v.startsWith('TMUX='));
}

/** Les sessions interactives vivantes déclarées dans chacun des dossiers de config donnés (null = ~/.claude). */
export function processusClaude(configDirs: readonly (string | null)[], journal: Logger): ProcessusClaude[] {
  const resultat: ProcessusClaude[] = [];
  for (const configDir of new Set(configDirs)) {
    const dossier = join(configDir ?? join(homedir(), '.claude'), 'sessions');
    if (!existsSync(dossier)) continue;
    for (const f of readdirSync(dossier).filter((n) => /^\d+\.json$/.test(n))) {
      const d = Declaration.safeParse(declaration(join(dossier, f), journal));
      if (!d.success || (d.data.kind && d.data.kind !== 'interactive') || !vivant(d.data.pid)) continue;
      resultat.push({
        pid: d.data.pid,
        sessionId: d.data.sessionId,
        cwd: d.data.cwd,
        enTmux: enTmux(d.data.pid),
        configDir,
        nom: d.data.name ?? null,
      });
    }
  }
  return resultat;
}
