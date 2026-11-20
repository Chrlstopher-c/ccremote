// Responsabilité : les processus Claude Code vivants de la machine, tels que Claude les déclare lui-même dans
// `<config>/sessions/<pid>.json` (identifiant de session exact, dossier, type). Sert à relier une session tmux à sa
// conversation sans deviner, et à voir les sessions lancées hors tmux (terminal ordinaire, Claude Desktop).
import { existsSync, readFileSync, readdirSync, readlinkSync } from 'node:fs';
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
  procStart: z.union([z.string(), z.number()]).optional(),
});

export interface ProcessusClaude {
  readonly pid: number;
  readonly sessionId: string;
  readonly cwd: string;
  readonly enTmux: boolean;
  readonly configDir: string | null;
  readonly nom: string | null; // nom donné par Claude (/rename, --name) dans son registre natif
}

/** Ce que le système dit d'un processus : nom, binaire, heure de démarrage (jiffies), environnement tmux. */
export interface EtatProcessus {
  readonly comm: string;
  readonly exe: string;
  readonly demarrage: string | null;
  readonly enTmux: boolean;
}

export type LecteurProcessus = (pid: number) => EtatProcessus | null;

function lire(chemin: string): string {
  try {
    return readFileSync(chemin, 'utf8');
  } catch {
    return ''; // processus terminé entre la liste et la lecture : ignoré
  }
}

// Champ 22 de /proc/<pid>/stat (heure de démarrage). Le nom peut contenir des espaces : repère sur la parenthèse.
function demarrageDe(stat: string): string | null {
  const reste = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
  return reste[19] ?? null;
}

/** Lecture réelle de /proc. Un processus disparu rend null. */
export const lecteurProc: LecteurProcessus = (pid) => {
  if (!existsSync(`/proc/${pid}`)) return null;
  const comm = lire(`/proc/${pid}/comm`).trim();
  if (comm === '') return null;
  let exe = '';
  try {
    exe = readlinkSync(`/proc/${pid}/exe`);
  } catch {
    exe = ''; // binaire illisible (autre utilisateur) : le nom suffit
  }
  return {
    comm,
    exe,
    demarrage: demarrageDe(lire(`/proc/${pid}/stat`)),
    enTmux: lire(`/proc/${pid}/environ`)
      .split('\0')
      .some((v) => v.startsWith('TMUX=')),
  };
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

const VERSION_BINAIRE = /^\d+\.\d+\.\d+/; // Claude Desktop lance son CLI sous un nom de version (ex. 2.1.325-1ef04b3)

/** Un processus est bien ce Claude déclaré : même heure de démarrage (pas un pid recyclé) et un binaire Claude. */
export function processusVivant(decl: { readonly procStart?: string | number }, etat: EtatProcessus | null): boolean {
  if (etat === null) return false;
  if (decl.procStart !== undefined && etat.demarrage !== String(decl.procStart)) return false;
  return etat.comm === 'claude' || VERSION_BINAIRE.test(etat.comm) || etat.exe.includes('/ccd-cli/');
}

function declarationValide(
  chemin: string,
  journal: Logger,
): z.infer<typeof Declaration> | null {
  const d = Declaration.safeParse(declaration(chemin, journal));
  return d.success ? d.data : null;
}

/** Les sessions interactives vivantes déclarées dans chacun des dossiers de config donnés (null = ~/.claude). */
export function processusClaude(
  configDirs: readonly (string | null)[],
  journal: Logger,
  lecteur: LecteurProcessus = lecteurProc,
): ProcessusClaude[] {
  const resultat: ProcessusClaude[] = [];
  for (const configDir of new Set(configDirs)) {
    const dossier = join(configDir ?? join(homedir(), '.claude'), 'sessions');
    if (!existsSync(dossier)) continue;
    for (const f of readdirSync(dossier).filter((n) => /^\d+\.json$/.test(n))) {
      const d = declarationValide(join(dossier, f), journal);
      if (!d || (d.kind && d.kind !== 'interactive')) continue;
      const etat = lecteur(d.pid);
      if (!processusVivant(d, etat)) continue;
      resultat.push({
        pid: d.pid,
        sessionId: d.sessionId,
        cwd: d.cwd,
        enTmux: etat?.enTmux ?? false,
        configDir,
        nom: d.name ?? null,
      });
    }
  }
  return resultat;
}

/** Identifiants des conversations tenues en ce moment par un processus Claude de ces configurations. */
export function conversationsVivantes(configDirs: readonly (string | null)[], journal: Logger): Set<string> {
  return new Set(processusClaude(configDirs, journal).map((p) => p.sessionId));
}

/** Une conversation tenue par un autre processus ne se reprend pas : deux processus écriraient le même transcript. */
export function tenueAilleurs(
  id: string | null,
  configDirs: readonly (string | null)[],
  journal: Logger,
): string | null {
  if (!id || !conversationsVivantes(configDirs, journal).has(id)) return null;
  return 'conversation ouverte dans un autre processus Claude (Desktop ou terminal) : la fermer avant de la reprendre';
}
