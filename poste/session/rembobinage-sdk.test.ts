import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ecrireTranscriptEssai, UUID_ESSAI } from './transcript-essai.ts';
import { attendre, nouvelleSession } from './faux-sdk.ts';
import { fantomes, fichePourIdentifiant } from './identifiants-fiche.ts';
import type { SessionPersistee } from './persistance.ts';

describe('SessionSdk — rembobinage du premier message', () => {
  test('après le premier message rembobiné, le prochain envoi repart d’une conversation neuve (sans reprise)', async () => {
    const { session, requetes } = nouvelleSession(async () => [{ type: 'result' }], {
      reprise: { statut: 'attente', aReprendre: true },
    });
    expect(session.resume.claudeSessionId).toBe('claude-abc');
    session.recommencer();
    expect(session.resume.claudeSessionId).toBeNull();
    expect(await session.envoyer('deux')).toBeNull();
    await attendre(() => requetes.length === 1);
    const options = requetes[0]?.options;
    expect(options?.resume).toBeUndefined();
    expect(options?.resumeSessionAt).toBeUndefined();
    expect(options?.sessionId).toBeDefined();
    expect(options?.sessionId).not.toBe('claude-abc');
    await attendre(() => session.resume.statut === 'attente');
  });
});

describe('SessionSdk — le transcript de la conversation recommencée reste à la fiche', () => {
  test('la nouvelle conversation SDK est retenue par la fiche, avant l’adoption et après relance du poste', async () => {
    const { session, requetes } = nouvelleSession(async () => [{ type: 'result' }], {
      reprise: { statut: 'attente', aReprendre: true },
    });
    session.recommencer();
    expect(await session.envoyer('deux')).toBeNull();
    await attendre(() => requetes.length === 1);
    const neuf = requetes[0]?.options.sessionId ?? '';
    await attendre(() => session.resume.statut === 'attente');
    const relue = JSON.parse(JSON.stringify(session.persistee)) as SessionPersistee;
    const fiches = [relue];
    expect(fichePourIdentifiant(fiches, neuf)?.resume.id).toBe(session.resume.id);
    expect(fichePourIdentifiant(fiches, 'claude-abc')?.resume.id).toBe(session.resume.id);
    expect(fantomes(fiches)).toEqual([]);
  });
});

describe('SessionSdk — rembobinage d’une session à configuration dédiée (invité, autre compte)', () => {
  const dossiers: string[] = [];
  afterEach(() => {
    for (const d of dossiers.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  test('le transcript est lu dans la configuration de la session : la reprise part de l’entrée qui précède', async () => {
    const config = mkdtempSync(join(tmpdir(), 'rembobinage-config-'));
    dossiers.push(config);
    ecrireTranscriptEssai(config, '/projets/app');
    const { session, requetes } = nouvelleSession(async () => [{ type: 'result' }], {
      configDir: config,
      reprise: { statut: 'attente', claudeSessionId: UUID_ESSAI },
    });
    expect(await session.rembobiner('u2')).toBeNull();
    expect(await session.envoyer('deux bis')).toBeNull();
    await attendre(() => requetes.length === 1);
    expect(requetes[0]?.options.resume).toBe(UUID_ESSAI);
    expect(requetes[0]?.options.resumeSessionAt).toBe('a1');
  });
});
