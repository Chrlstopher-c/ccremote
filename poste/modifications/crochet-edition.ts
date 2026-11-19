// Responsabilité : le crochet PreToolUse des sessions SDK qui relève le contenu d'un fichier avant qu'un outil
// d'édition le modifie. Il ne bloque, n'autorise ni ne refuse jamais l'outil : une erreur est journalisée, l'outil
// passe.
import type { HookCallbackMatcher, HookInput } from '@anthropic-ai/claude-agent-sdk';
import type { Logger } from 'pino';
import { resolve } from 'node:path';
import { z } from 'zod';

export const OUTILS_D_EDITION = 'Edit|Write|MultiEdit|NotebookEdit';

const ENTREE_EDITION = z.object({ file_path: z.string().optional(), notebook_path: z.string().optional() });

/** Chemin absolu du fichier que l'outil d'édition va toucher, ou null si l'entrée n'en désigne aucun. */
export function cheminEdite(entree: unknown, cwd: string): string | null {
  const lue = ENTREE_EDITION.safeParse(entree);
  if (!lue.success) return null;
  const chemin = lue.data.file_path ?? lue.data.notebook_path;
  return chemin ? resolve(cwd, chemin) : null;
}

export function crochetEdition(cwd: string, noter: (absolu: string) => void, journal: Logger): HookCallbackMatcher {
  return {
    matcher: OUTILS_D_EDITION,
    hooks: [
      async (entree: HookInput) => {
        if (entree.hook_event_name !== 'PreToolUse') return {};
        const absolu = cheminEdite(entree.tool_input, cwd);
        if (absolu !== null) {
          try {
            noter(absolu);
          } catch (erreur) {
            journal.warn({ err: erreur, chemin: absolu }, 'édition non relevée : l’outil continue');
          }
        }
        return {};
      },
    ],
  };
}
