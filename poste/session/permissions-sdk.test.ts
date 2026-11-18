// Responsabilité : tests des demandes de permission — dialogue montré à Chris et décision rendue au SDK.
import { describe, expect, test } from 'bun:test';
import type { PermissionUpdate } from '@anthropic-ai/claude-agent-sdk';
import { decisionPermission, dialoguePermission, TAILLE_ENTREE } from './permissions-sdk.ts';

const REGLE: PermissionUpdate[] = [
  { type: 'addRules', rules: [{ toolName: 'Bash' }], behavior: 'allow', destination: 'session' },
];

describe('dialoguePermission', () => {
  test('trois options fixes, outil et entrée montrés, suggestion signalée', () => {
    const d = dialoguePermission('p-1', 'Bash', { command: 'ls' }, REGLE);
    expect(d.titre).toBe('Autoriser Bash ?');
    expect(d.options.map((o) => o.libelle)).toEqual(['Autoriser', 'Toujours autoriser', 'Refuser']);
    expect(d.permission?.outil).toBe('Bash');
    expect(d.permission?.suggestion).toBe(true);
    expect(d.permission?.entree).toContain('"command"');
  });

  test('entrée trop longue tronquée, sans suggestion', () => {
    const grosse = { texte: 'x'.repeat(TAILLE_ENTREE + 500) };
    const d = dialoguePermission('p-2', 'Write', grosse, []);
    expect(d.permission?.entree.endsWith('…')).toBe(true);
    expect(d.permission?.suggestion).toBe(false);
  });
});

describe('decisionPermission', () => {
  const entree = { command: 'ls' };

  test('autoriser une fois : allow avec l’entrée, sans règle', () => {
    expect(decisionPermission(entree, REGLE, { id: 'p', index: 0 })).toEqual({
      behavior: 'allow',
      updatedInput: entree,
    });
  });

  test('toujours autoriser : allow avec les règles proposées par le SDK', () => {
    expect(decisionPermission(entree, REGLE, { id: 'p', index: 1 })).toEqual({
      behavior: 'allow',
      updatedInput: entree,
      updatedPermissions: [...REGLE],
    });
  });

  test('refuser : deny avec un motif, sans interrompre', () => {
    expect(decisionPermission(entree, REGLE, { id: 'p', index: 2 })).toEqual({
      behavior: 'deny',
      message: 'Refusé par Chris',
    });
  });

  test('index hors des options : aucune décision', () => {
    expect(decisionPermission(entree, REGLE, { id: 'p', index: 3 })).toBeNull();
  });
});
