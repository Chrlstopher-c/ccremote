/**
 * Responsabilité : résoudre le chemin du transcript JSONL d'une mission depuis les trois
 * colonnes déjà connues du superviseur (SPEC F-3) : `sessionId`, `cwd` (worktree), et le
 * `configDir` du compte de la mission — sans réseau, sans dépendre du registre Pi.
 *
 * `☠` `cleProjet()` (remplacement `/` et `\` par `-` dans le cwd absolu) est dupliquée
 * depuis `harness/superviseur/sous-agents-disque.ts` À DESSEIN : ce fichier privé n'est pas
 * exporté, et ce module vit dans un domaine distinct (`apprentissage/` vs `superviseur/`) qui
 * n'a aucune raison de changer en même temps — exactement le motif que
 * `sous-agents-disque.ts` documente lui-même pour sa propre copie depuis
 * `composition/pi/verificateur-session-sdk.ts`. Une mutualisation les coupleraient sans
 * bénéfice (duplication accidentelle, code-standards.md « DRY : accidentel vs métier »).
 *
 * Conception inspirée de Hermes Agent (Nous Research) — MIT. Transposition indépendante en TypeScript.
 */

import { join } from 'node:path';

/** Voir l'en-tête : dupliquée à dessein depuis `superviseur/sous-agents-disque.ts`. */
function cleProjet(cwd: string): string {
  return cwd.replace(/[/\\]/g, '-');
}

/**
 * `<configDir>/projects/<cleProjet(cwd)>/<sessionId>.jsonl` — disposition vérifiée (SPEC F-1).
 * `cwd` doit être le worktree RÉEL de la session (celui que le CLI a effectivement utilisé),
 * pas le dépôt logique — c'est le CLI qui choisit la clé de projet sur son propre `cwd`.
 */
export function cheminTranscriptMission(configDir: string, cwd: string, sessionId: string): string {
  return join(configDir, 'projects', cleProjet(cwd), `${sessionId}.jsonl`);
}
