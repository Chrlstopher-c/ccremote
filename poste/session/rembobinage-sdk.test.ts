import { describe, expect, test } from 'bun:test';
import { attendre, nouvelleSession } from './faux-sdk.ts';

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
