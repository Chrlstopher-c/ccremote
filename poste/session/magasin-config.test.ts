import { afterEach, describe, expect, test } from 'bun:test';
import { forkSession, getSessionMessages } from '@anthropic-ai/claude-agent-sdk';
import { existsSync, mkdtempSync, renameSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { optionsMagasin } from './magasin-config.ts';
import { cheminTranscript } from './transcript.ts';
import { ecrireTranscriptEssai, UUID_ESSAI } from './transcript-essai.ts';

const dossiers: string[] = [];
function configNeuve(): string {
  const d = mkdtempSync(join(tmpdir(), 'magasin-config-'));
  dossiers.push(d);
  return d;
}
afterEach(() => {
  for (const d of dossiers.splice(0)) rmSync(d, { recursive: true, force: true });
});

const CWD = '/espace/invite';

describe('transcripts d’une configuration Claude dédiée (invité, autre compte)', () => {
  test('sans magasin, le SDK ne cherche que dans la configuration du processus : rien (cause du défaut)', async () => {
    const config = configNeuve();
    ecrireTranscriptEssai(config, CWD);
    expect(await getSessionMessages(UUID_ESSAI, { dir: CWD })).toEqual([]);
  });

  test('les messages de la conversation sont lus dans sa configuration', async () => {
    const config = configNeuve();
    ecrireTranscriptEssai(config, CWD);
    const messages = await getSessionMessages(UUID_ESSAI, { dir: CWD, ...optionsMagasin(config) });
    expect(messages.map((m) => m.uuid)).toEqual(['u1', 'a1', 'u2', 'a2']);
  });

  test('dossier de projet nommé autrement (chemin Windows) : le transcript est retrouvé par son identifiant', async () => {
    const config = configNeuve();
    const chemin = ecrireTranscriptEssai(config, CWD);
    const ailleurs = join(config, 'projects', 'C--Users-invite-espace');
    renameSync(dirname(chemin), ailleurs);
    const messages = await getSessionMessages(UUID_ESSAI, { dir: CWD, ...optionsMagasin(config) });
    expect(messages.length).toBe(4);
  });

  test('la copie (duplication) est écrite dans la même configuration, à l’endroit où Claude Code la reprend', async () => {
    const config = configNeuve();
    ecrireTranscriptEssai(config, CWD);
    const r = await forkSession(UUID_ESSAI, { dir: CWD, upToMessageId: 'a1', ...optionsMagasin(config) });
    expect(existsSync(cheminTranscript(CWD, r.sessionId, config))).toBe(true);
    const copie = await getSessionMessages(r.sessionId, { dir: CWD, ...optionsMagasin(config) });
    expect(copie.length).toBe(2);
  });

  test('configuration par défaut : aucune option ajoutée (comportement du SDK inchangé)', () => {
    expect(optionsMagasin(null)).toEqual({});
  });
});
