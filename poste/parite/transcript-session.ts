// Responsabilité : retrouver le transcript JSONL d'une session du poste. Session connue du gestionnaire : son dossier
// de configuration ; sinon recherche de la conversation dans les dossiers projets de toutes les configurations.
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Logger } from 'pino';
import { dossiersProjets } from '../session/decouverte.ts';
import { cheminTranscript } from '../session/transcript.ts';

const IDENTIFIANT_CONVERSATION = /^[A-Za-z0-9_-]{1,200}$/;

export interface CibleTranscript {
  readonly cwd: string;
  readonly claudeSessionId: string | null;
}

/**
 * Le transcript de la conversation. `configDir` : undefined si la session n'est pas connue du gestionnaire (recherche),
 * sinon sa configuration (null = config par défaut).
 */
export function transcriptDeSession(
  cible: CibleTranscript,
  configDir: string | null | undefined,
  configs: readonly (string | null)[],
  journal: Logger,
): string | null {
  const conversation = cible.claudeSessionId;
  if (conversation === null || !IDENTIFIANT_CONVERSATION.test(conversation)) return null;
  if (configDir !== undefined) {
    const connu = cheminTranscript(cible.cwd, conversation, configDir);
    if (existsSync(connu)) return connu;
  }
  return chercherDansProjets(conversation, configs, journal);
}

/** Recherche dans les dossiers projets de toutes les configurations (`<projets>/<dossier>/<conversation>.jsonl`). */
export function chercherDansProjets(
  conversation: string,
  configs: readonly (string | null)[],
  journal: Logger,
): string | null {
  for (const base of dossiersProjets(configs)) {
    for (const dossier of sousDossiers(base, journal)) {
      const candidat = join(base, dossier, `${conversation}.jsonl`);
      if (existsSync(candidat)) return candidat;
    }
  }
  return null;
}

function sousDossiers(base: string, journal: Logger): string[] {
  try {
    return readdirSync(base, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch (erreur) {
    journal.warn({ err: erreur, base }, 'dossier projets illisible');
    return [];
  }
}
