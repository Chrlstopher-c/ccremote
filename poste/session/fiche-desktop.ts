// Responsabilité : les fiches de sessions de Claude Desktop (`~/.config/Claude/claude-code-sessions/<org>/<compte>/
// local_<id>.json`), lues en lecture seule : archivage, mode, modèle, identifiant de la conversation CLI, jumelles
// Remote Control. Rien n'y est écrit.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Logger } from 'pino';
import { z } from 'zod';
import type { ModeSession } from '../../commun/session.ts';

const FicheBrute = z.object({
  cliSessionId: z.string().optional(),
  cwd: z.string().optional(),
  model: z.string().optional(),
  permissionMode: z.string().optional(),
  isArchived: z.boolean().optional(),
  title: z.string().optional(),
  remoteControlUserEnabled: z.boolean().optional(),
  bridgeSessionIds: z.array(z.string()).optional(),
});

export interface FicheDesktop {
  readonly conversation: string;
  readonly cwd: string | null;
  readonly modele: string | null;
  readonly mode: ModeSession | null;
  readonly archivee: boolean;
  readonly titre: string | null;
  readonly remoteControl: boolean;
  readonly ponts: readonly string[];
}

const MODES: ReadonlySet<string> = new Set(['bypassPermissions', 'default', 'acceptEdits', 'plan', 'auto']);
export const RACINE_DESKTOP_DEFAUT = join(homedir(), '.config', 'Claude', 'claude-code-sessions');

function fichiers(dossier: string, profondeur: number): string[] {
  let noms: string[];
  try {
    noms = readdirSync(dossier);
  } catch {
    return []; // dossier absent : Desktop n'est pas installé ici
  }
  return noms.flatMap((nom) => {
    const chemin = join(dossier, nom);
    if (nom.startsWith('local_') && nom.endsWith('.json')) return [chemin];
    return profondeur > 0 ? fichiers(chemin, profondeur - 1) : [];
  });
}

function lireUne(chemin: string, journal: Logger): FicheDesktop | null {
  try {
    const r = FicheBrute.safeParse(JSON.parse(readFileSync(chemin, 'utf8')));
    if (!r.success || !r.data.cliSessionId) return null;
    const f = r.data;
    return {
      conversation: f.cliSessionId ?? '',
      cwd: f.cwd ?? null,
      modele: f.model ?? null,
      mode: f.permissionMode && MODES.has(f.permissionMode) ? (f.permissionMode as ModeSession) : null,
      archivee: f.isArchived === true,
      titre: f.title ?? null,
      remoteControl: f.remoteControlUserEnabled === true,
      ponts: f.bridgeSessionIds ?? [],
    };
  } catch (erreur) {
    journal.debug({ err: erreur, chemin }, 'fiche Desktop illisible ignorée');
    return null;
  }
}

/** Les fiches Desktop par identifiant de conversation CLI. Racine absente = aucune fiche. */
export function fichesDesktop(racine: string, journal: Logger): Map<string, FicheDesktop> {
  const carte = new Map<string, FicheDesktop>();
  if (!existsSync(racine)) return carte;
  for (const chemin of fichiers(racine, 3)) {
    const f = lireUne(chemin, journal);
    if (f) carte.set(f.conversation, f);
  }
  return carte;
}
