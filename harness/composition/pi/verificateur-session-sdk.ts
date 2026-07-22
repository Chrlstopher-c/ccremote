/**
 * Responsabilité : implémentation RÉELLE de `VerificateurSessionExistante`
 * (`control-plane/orchestrateur/processus/identite.ts`) — répondre à « le SDK
 * connaît-il déjà cette session ? », dont dépend le choix `resume` vs froid.
 *
 * `☠ CASSE RÉELLE (2026-07-23, prod)` — la version précédente appelait
 * `getSessionInfo(id, { dir: cwd })` et traitait `undefined` comme « n'existe
 * pas ». Deux défauts, chacun suffisant à casser toute reprise de conversation :
 *
 *  1. `dir` désigne le RÉPERTOIRE DE PROJET, pas le `CLAUDE_CONFIG_DIR`. Les
 *     transcripts de l'orchestrateur vivent sous son propre config dir
 *     (`/home/pi/.claude-orchestrateur/projects/…`) — la recherche par défaut
 *     ne les voyait jamais.
 *  2. `getSessionInfo` n'est PAS un test d'existence : sa documentation dit
 *     qu'il rend `undefined` aussi pour une session « sans résumé extractible »
 *     ou en sidechain. Une session courte existe donc sans être vue.
 *
 * Conséquence mesurée en production : toute conversation reprise repartait en
 * démarrage FROID sur un `sessionId` que le CLI connaissait déjà, et le
 * pré-chauffage échouait sur `Session ID … is already in use` — chaque message
 * envoyé à un ancien fil rendait « erreur interne du control plane ».
 *
 * Correction : on constate l'existence du FICHIER de transcript, seul fait
 * réellement observable, à l'emplacement où le CLI l'écrit vraiment. Le repli
 * `getSessionInfo` ne sert plus qu'à rattraper une disposition inattendue.
 */

import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { getSessionInfo } from '@anthropic-ai/claude-agent-sdk';
import type { VerificateurSessionExistante } from '../../control-plane/orchestrateur/processus/index.ts';
import { compositionLogger } from '../logger.ts';

const log = compositionLogger.child({ composant: 'verificateur-session-sdk' });

/**
 * Clé de projet du CLI : le chemin absolu du cwd, séparateurs remplacés par des
 * tirets. Vérifié sur le Pi (`/home/pi/ccremote-harness` →
 * `-home-pi-ccremote-harness`) et cohérent avec la `projectKey` déjà mesurée sur
 * le `SessionStore` réel (REPRISE.md).
 */
export function cleProjet(cwd: string): string {
  return cwd.replace(/[/\\]/g, '-');
}

/** Emplacement réel du transcript d'une session, tel que le CLI l'écrit. */
export function cheminTranscript(sessionId: string, cwd: string, configDir?: string): string {
  const racine = configDir ?? join(homedir(), '.claude');
  return join(racine, 'projects', cleProjet(cwd), `${sessionId}.jsonl`);
}

export function creerVerificateurSessionSdk(cwd: string, configDir?: string): VerificateurSessionExistante {
  return {
    async existe(sessionId: string): Promise<boolean> {
      const chemin = cheminTranscript(sessionId, cwd, configDir);
      if (existsSync(chemin)) return true;

      // Repli : le fichier n'est pas là où on l'attend. `getSessionInfo` peut
      // encore la trouver ailleurs — mais son `undefined` reste ambigu, donc il
      // ne sert qu'à CONFIRMER une existence, jamais à prononcer une absence.
      try {
        const info = await getSessionInfo(sessionId, { dir: cwd });
        if (info !== undefined) return true;
      } catch (erreur) {
        log.warn({ err: erreur, sessionId }, 'getSessionInfo en échec — repli sans effet');
      }
      log.info({ sessionId, chemin }, 'aucun transcript trouvé — la session sera démarrée à froid');
      return false;
    },
  };
}
