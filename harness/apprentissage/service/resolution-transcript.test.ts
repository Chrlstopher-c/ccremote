/**
 * Preuve F-1/F-3 : `cheminTranscriptMission` doit calculer le chemin RÉELLEMENT écrit par le
 * CLI Claude Code, pas une approximation. Chaque cas compare le chemin CALCULÉ à un chemin
 * RÉELLEMENT PRÉSENT sur le disque de ce compte — la seule forme qui prouve quelque chose ici
 * (un test qui invente son propre dossier ne peut pas attraper une divergence avec le CLI réel).
 *
 * `☠` Ces trois transcripts sont ceux qui ont établi la règle d'encodage (voir l'en-tête de
 * `resolution-transcript.ts`) : un projet ordinaire, un worktree (`.worktrees`, point en tête
 * de segment) et un cwd à underscore. Si ces dossiers disparaissent du compte, ce test cesse
 * d'être une preuve — il doit alors être rebranché sur des transcripts encore présents.
 */

import { describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { cheminTranscriptMission } from './resolution-transcript.ts';

const CONFIG_DIR = '/home/trinity/.claude-comptes/compte-a';

describe('cheminTranscriptMission — encodage réel du CLI (mesuré, pas deviné)', () => {
  test('projet ordinaire (séparateur `/` seul)', () => {
    const chemin = cheminTranscriptMission(CONFIG_DIR, '/mnt/projects/agora', '02163e3d-62b1-4449-8a22-ddca7872d925');
    expect(chemin).toBe(
      '/home/trinity/.claude-comptes/compte-a/projects/-mnt-projects-agora/02163e3d-62b1-4449-8a22-ddca7872d925.jsonl',
    );
    expect(existsSync(chemin)).toBe(true);
  });

  test('worktree — dossier dont le segment commence par un point (`.worktrees`)', () => {
    const chemin = cheminTranscriptMission(
      CONFIG_DIR,
      '/mnt/projects/.worktrees/30b4f953-e55c-4677-9e33-ebf404c8bf8f',
      'd9581512-8adc-4231-81a2-99227e38df49',
    );
    expect(chemin).toBe(
      '/home/trinity/.claude-comptes/compte-a/projects/-mnt-projects--worktrees-30b4f953-e55c-4677-9e33-ebf404c8bf8f/d9581512-8adc-4231-81a2-99227e38df49.jsonl',
    );
    expect(existsSync(chemin)).toBe(true);
  });

  test('cwd à underscore — le CLI encode `_` comme les autres séparateurs', () => {
    const chemin = cheminTranscriptMission(
      CONFIG_DIR,
      '/tmp/ccremote-demo-apprentissage/avec_lecon-1-e8ddf209',
      'e8ddf209-8704-4874-98b3-3c291e054fe2',
    );
    expect(chemin).toBe(
      '/home/trinity/.claude-comptes/compte-a/projects/-tmp-ccremote-demo-apprentissage-avec-lecon-1-e8ddf209/e8ddf209-8704-4874-98b3-3c291e054fe2.jsonl',
    );
    expect(existsSync(chemin)).toBe(true);
  });
});
