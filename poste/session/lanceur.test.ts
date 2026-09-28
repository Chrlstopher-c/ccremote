import { describe, expect, test } from 'bun:test';
import { commandeClaude } from './lanceur.ts';

const base = { sessionId: 's1', titre: 'T', consignes: 'C', reprise: false };

describe('ligne de commande claude', () => {
  test('rien de variadique juste avant le message (ajouté en dernier par l’appelant)', () => {
    for (const modele of [null, 'haiku']) {
      const c = commandeClaude({ ...base, modele });
      const avantDernier = c.at(-2) ?? '';
      expect(['--mcp-config', '--add-dir']).not.toContain(avantDernier);
      expect(c.indexOf('--mcp-config')).toBe(1);
    }
  });

  test('reprise : --resume, sans --session-id ni --name', () => {
    const c = commandeClaude({ ...base, modele: null, reprise: true });
    expect(c).toContain('--resume');
    expect(c).not.toContain('--session-id');
  });
});
