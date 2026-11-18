import { describe, expect, test } from 'bun:test';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { nouvelEtatTraduction, traduireSdk } from './traduction-sdk.ts';

const msg = (valeur: unknown): SDKMessage => valeur as SDKMessage;

describe('traduction : outils de présentation', () => {
  test('un appel lanterne n’a pas de carte, et son résultat est masqué', () => {
    const etat = nouvelEtatTraduction();
    const appel = msg({
      type: 'assistant',
      message: {
        content: [{ type: 'tool_use', id: 'p1', name: 'mcp__lanterne__envoyer_fichier', input: { chemin: 'x' } }],
      },
      parent_tool_use_id: null,
    });
    expect(traduireSdk(appel, etat).evenements).toEqual([]);
    const resultat = msg({
      type: 'user',
      message: { content: [{ type: 'tool_result', tool_use_id: 'p1', content: 'Fichier présenté' }] },
      parent_tool_use_id: null,
    });
    expect(traduireSdk(resultat, etat).evenements).toEqual([]);
  });

  test('un autre outil reste une carte, avec son résultat', () => {
    const etat = nouvelEtatTraduction();
    const appel = msg({
      type: 'assistant',
      message: { content: [{ type: 'tool_use', id: 'b1', name: 'Bash', input: { command: 'ls' } }] },
      parent_tool_use_id: null,
    });
    expect(traduireSdk(appel, etat).evenements.map((e) => e.type)).toEqual(['outil']);
    const resultat = msg({
      type: 'user',
      message: { content: [{ type: 'tool_result', tool_use_id: 'b1', content: 'fichiers' }] },
      parent_tool_use_id: null,
    });
    expect(traduireSdk(resultat, etat).evenements.map((e) => e.type)).toEqual(['resultat_outil']);
  });
});
