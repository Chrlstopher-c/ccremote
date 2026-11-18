import { describe, expect, test } from 'bun:test';
import type { SDKControlGetContextUsageResponse } from '@anthropic-ai/claude-agent-sdk';
import { CONTEXTE_FAUX } from './faux-sdk.ts';
import { contexteDe } from './contexte-sdk.ts';
import { ContexteSession } from '../../commun/panneau.ts';

const reponse = CONTEXTE_FAUX as unknown as SDKControlGetContextUsageResponse; // forme partielle, voir faux-sdk.ts

describe('contexteDe', () => {
  test('répartit les catégories entre utilisé, libre, tampon et différé, et garde outils MCP et mémoire', () => {
    const contexte = contexteDe(reponse);
    expect(contexte.modele).toBe('claude-haiku-5-5');
    expect(contexte.fenetre).toBe(1_000_000);
    expect(contexte.utilises).toBe(30_000);
    expect(contexte.pourcentage).toBe(3);
    expect(contexte.categories.map((c) => [c.libelle, c.genre])).toEqual([
      ['System prompt', 'utilise'],
      ['Messages', 'utilise'],
      ['Autocompact buffer', 'tampon'],
      ['Free space', 'libre'],
    ]);
    expect(contexte.categoriesDifferees.map((c) => c.genre)).toEqual(['differe']);
    expect(contexte.outilsMcp).toEqual([{ serveur: 'claude_ai_Flix', outil: 'my_library', jetons: 100, differe: true }]);
    expect(contexte.fichiersMemoire).toEqual([{ chemin: '/projets/app/CLAUDE.md', type: 'Project', jetons: 800 }]);
    expect(ContexteSession.parse(contexte)).toEqual(contexte);
  });

  test('un outil chargé n’est pas différé, et un nom sans préfixe garde son nom', () => {
    const contexte = contexteDe({
      ...reponse,
      mcpTools: [
        { name: 'mcp__ccremote__rythme', serverName: 'ccremote', tokens: 40, isLoaded: true },
        { name: 'outil_nu', serverName: 'externe', tokens: 5 },
      ],
    });
    expect(contexte.outilsMcp).toEqual([
      { serveur: 'ccremote', outil: 'rythme', jetons: 40, differe: false },
      { serveur: 'externe', outil: 'outil_nu', jetons: 5, differe: false },
    ]);
  });
});
