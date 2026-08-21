/**
 * Responsabilité : garde 3 (accès `rapport`, mandat opérateur 21/08) — le
 * verrou RÉEL qui confine Write/Edit/NotebookEdit au worktree de l'équipe.
 *
 * `☠ POURQUOI CE FICHIER EXISTE, ET PAS `shared/acces-mandat.ts`.`
 * `disallowedTools`/`outilsRefusesPour` ne savent refuser que par nom d'outil
 * entier (`Write`) ou motif glob POSITIF (`Write` sur `.env`, voir le plancher
 * de déni) — cette grammaire n'a pas de négation, on ne peut pas y écrire
 * « refuse tout Write HORS de X ». Un hook `PreToolUse` est le seul canal du
 * SDK qui reçoit à la fois le chemin visé (`tool_input.file_path`) ET peut
 * renvoyer un refus (`hookSpecificOutput.permissionDecision: 'deny'`) —
 * indépendamment de `permissionMode` d'après la documentation du SDK
 * (« PreToolUse hook denies bypass canUseTool »).
 *
 * `☠ CE QUE CE VERROU NE GARANTIT PAS` (à dire dans le rapport de mission,
 * jamais à taire) : contrairement au plancher de déni scopé
 * (`acceptation/bypass-denis-reel.ts`, `plancher-moteur-reel.ts`), AUCUN banc
 * `acceptation/*-reel.ts` de ce dépôt n'exerce ce chemin contre le vrai
 * binaire CLI. La forme est correcte au regard des types du SDK ; elle n'est
 * pas mesurée en réel.
 *
 * Distinct de `control-plane/audit-permissions/hooks-sdk.ts` : ce module-là
 * n'arbitre JAMAIS (observation vide systématique, C.1.1) — celui-ci est le
 * seul du dépôt qui renvoie une décision de refus depuis un hook `PreToolUse`.
 */

import { isAbsolute, resolve } from 'node:path';
import type { HookCallback, HookCallbackMatcher, HookEvent, SyncHookJSONOutput } from '@anthropic-ai/claude-agent-sdk';

const AUCUNE_DECISION: SyncHookJSONOutput = {};

/** Outils que la garde 3 confine — les trois qu' `outilsRefusesPour('lecture')` refuse en bloc. */
const OUTILS_CONFINES: readonly string[] = ['Write', 'Edit', 'NotebookEdit'];

/** Sonde minimale : `tool_input` est `unknown` côté SDK, jamais casté vers un type précis. */
function cheminDemande(entree: unknown): string | null {
  if (typeof entree !== 'object' || entree === null) return null;
  const valeur = (entree as Record<string, unknown>)['file_path'];
  return typeof valeur === 'string' ? valeur : null;
}

/** `true` si `cible` est le worktree lui-même ou l'un de ses descendants. */
function estDansWorktree(cible: string, worktree: string): boolean {
  const racine = resolve(worktree);
  const chemin = isAbsolute(cible) ? resolve(cible) : resolve(worktree, cible);
  return chemin === racine || chemin.startsWith(`${racine}/`);
}

/**
 * Le hook lui-même. `☠` FAIL-CLOSED : un `file_path` absent ou illisible est
 * REFUSÉ, jamais laissé passer — un outil dont on n'a pas su lire la cible ne
 * doit jamais bénéficier du doute.
 */
export function construireHookConfinementEcriture(worktree: string): HookCallback {
  return async (input): Promise<SyncHookJSONOutput> => {
    if (input.hook_event_name !== 'PreToolUse') return AUCUNE_DECISION;
    if (!OUTILS_CONFINES.includes(input.tool_name)) return AUCUNE_DECISION;
    const cible = cheminDemande(input.tool_input);
    if (cible !== null && estDansWorktree(cible, worktree)) return AUCUNE_DECISION;
    return {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason:
          `accès « rapport » : écriture confinée à ${worktree} — ` +
          `« ${cible ?? '(chemin illisible)'} » est hors de ce répertoire.`,
      },
    };
  };
}

/** Entrée `Options.hooks` prête à fusionner avec les autres (audit, etc.). */
export function creerHooksConfinementEcriture(worktree: string): Partial<Record<HookEvent, HookCallbackMatcher[]>> {
  return { PreToolUse: [{ hooks: [construireHookConfinementEcriture(worktree)] }] };
}
