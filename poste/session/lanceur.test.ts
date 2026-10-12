import { describe, expect, test } from 'bun:test';
import { commandeClaude, commandeReprise } from './lanceur.ts';

const base = { sessionId: 's1', titre: 'T', consignes: 'C', reprise: false };

describe('ligne de commande claude', () => {
  test('passe par cc (lanceur quart, id, nom) puis les options de claude', () => {
    const c = commandeClaude({ ...base, modele: null });
    expect(c[0]).toMatch(/\/cc$/);
    expect(c.slice(1, 8)).toEqual(['--lanceur', 'quart', '--id', 's1', '--nom', 'T', '--']);
    expect(c[8]).toBe('--mcp-config');
  });

  test('rien de variadique juste avant le message (ajouté en dernier par l’appelant)', () => {
    for (const modele of [null, 'haiku']) {
      const c = commandeClaude({ ...base, modele });
      expect(['--mcp-config', '--add-dir']).not.toContain(c.at(-2) ?? '');
    }
  });

  test('lancement neuf : pas de --resume, cc ajoute --session-id et --name', () => {
    const c = commandeClaude({ ...base, modele: null });
    expect(c).not.toContain('--resume');
    expect(c).not.toContain('--session-id');
  });

  test('reprise : --resume transmis à cc, sans --session-id', () => {
    const c = commandeClaude({ ...base, modele: null, reprise: true });
    expect(c.slice(-2)).toEqual(['--resume', 's1']);
    expect(c).not.toContain('--session-id');
  });

  test('reprise d une session adoptée : lanceur conservé, --resume transmis', () => {
    const c = commandeReprise('s2', 'kitty');
    expect(c.slice(1, 7)).toEqual(['--lanceur', 'kitty', '--id', 's2', '--', '--resume']);
    expect(c[7]).toBe('s2');
  });
});
