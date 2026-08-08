/**
 * Responsabilité : résoudre le chemin du transcript JSONL d'une mission depuis les trois
 * colonnes déjà connues du superviseur (SPEC F-3) : `sessionId`, `cwd` (worktree), et le
 * `configDir` du compte de la mission — sans réseau, sans dépendre du registre Pi.
 *
 * `☠` `cleProjet()` est dupliquée depuis `harness/superviseur/sous-agents-disque.ts` À DESSEIN :
 * ce fichier privé n'est pas exporté, et ce module vit dans un domaine distinct
 * (`apprentissage/` vs `superviseur/`) qui n'a aucune raison de changer en même temps —
 * exactement le motif que `sous-agents-disque.ts` documente lui-même pour sa propre copie
 * depuis `composition/pi/verificateur-session-sdk.ts`. Une mutualisation les coupleraient
 * sans bénéfice (duplication accidentelle, code-standards.md « DRY : accidentel vs métier »).
 *
 * `☠ MESURÉ le 2026-08-08` sur plusieurs dossiers réels sous `<configDir>/projects/` : le CLI
 * n'encode pas QUE les séparateurs `/` — il remplace TOUT caractère hors `[a-zA-Z0-9-]`
 * (donc aussi `.` et `_`) par un tiret, un caractère pour un caractère, sans fusionner les
 * tirets consécutifs ni traiter le premier caractère à part. Exemples vérifiés : `/mnt/projects
 * /.worktrees/<uuid>` ⇒ `-mnt-projects--worktrees-<uuid>` (le `/` puis le `.` donnent bien DEUX
 * tirets) ; `/tmp/.../avec_lecon-1-<id>` ⇒ `...-avec-lecon-1-<id>` (le `_` devient un tiret).
 * L'ancienne regex `[/\\]` ne couvrait ni l'un ni l'autre — ENOENT systématique sur tout
 * transcript de worktree (`/mnt/projects/.worktrees/...`), donc sur toute mission réelle.
 *
 * Conception inspirée de Hermes Agent (Nous Research) — MIT. Transposition indépendante en TypeScript.
 */

import { join } from 'node:path';

/** Voir l'en-tête : dupliquée à dessein depuis `superviseur/sous-agents-disque.ts`. */
function cleProjet(cwd: string): string {
  return cwd.replace(/[^a-zA-Z0-9-]/g, '-');
}

/**
 * `<configDir>/projects/<cleProjet(cwd)>/<sessionId>.jsonl` — disposition vérifiée (SPEC F-1).
 * `cwd` doit être le worktree RÉEL de la session (celui que le CLI a effectivement utilisé),
 * pas le dépôt logique — c'est le CLI qui choisit la clé de projet sur son propre `cwd`.
 */
export function cheminTranscriptMission(configDir: string, cwd: string, sessionId: string): string {
  return join(configDir, 'projects', cleProjet(cwd), `${sessionId}.jsonl`);
}
