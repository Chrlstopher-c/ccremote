// Tests de la détection de divergence flux/store (H-72.3, mission M-50).
// ☠ CASSE couvert : un agent connu du store mais absent du flux ne doit
// jamais être omis ni lissé — voir « chiffre l'écart, ne le masque pas ».

import { describe, expect, test } from 'bun:test';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { ArbreFluxTempsReel, OUTIL_DELEGATION } from './arbre-flux.ts';
import { evaluerCompletude } from './completude-sous-agents.ts';
import type { LecteurSousAgents } from './types.ts';

function dispatch(id: string): SDKMessage {
  return {
    type: 'assistant',
    parent_tool_use_id: null,
    message: { content: [{ type: 'tool_use', id, name: OUTIL_DELEGATION }] },
    uuid: 'u',
    session_id: 's1',
  } as unknown as SDKMessage;
}

function texteSousAgent(id: string, texte: string): SDKMessage {
  return {
    type: 'assistant',
    parent_tool_use_id: id,
    message: { content: [{ type: 'text', text: texte }] },
    uuid: 'u2',
    session_id: 's1',
  } as unknown as SDKMessage;
}

class LecteurFactice implements LecteurSousAgents {
  constructor(private readonly agentIds: string[]) {}
  async listerSousAgents(): Promise<readonly string[]> {
    return this.agentIds;
  }
  async chargerMessagesAgent(): Promise<readonly []> {
    return [];
  }
}

class LecteurEnPanne implements LecteurSousAgents {
  async listerSousAgents(): Promise<readonly string[]> {
    throw new Error('store indisponible');
  }
  async chargerMessagesAgent(): Promise<readonly []> {
    return [];
  }
}

describe('evaluerCompletude', () => {
  test('reproduit H-72.3 : 5 dispatchés, 3 avec contenu, store confirme 5 connus', async () => {
    const arbre = new ArbreFluxTempsReel();
    for (const id of ['a1', 'a2', 'a3', 'a4', 'a5']) arbre.ingerer(dispatch(id));
    arbre.ingerer(texteSousAgent('a1', 'x'));
    arbre.ingerer(texteSousAgent('a2', 'y'));
    arbre.ingerer(texteSousAgent('a3', 'z'));

    const rapport = await evaluerCompletude(arbre, new LecteurFactice(['x1', 'x2', 'x3', 'x4', 'x5']), 's1');

    expect(rapport.sousAgentsDispatches).toBe(5);
    expect(rapport.sousAgentsAvecContenuFlux).toBe(3);
    expect(rapport.sousAgentsConnusStore).toBe(5);
    expect(rapport.divergenceDetectee).toBe(true);
    expect(rapport.sousAgentsSansDetailTempsReel).toBe(2);
  });

  test('aucune divergence quand tout le monde a produit du contenu', async () => {
    const arbre = new ArbreFluxTempsReel();
    arbre.ingerer(dispatch('a1'));
    arbre.ingerer(texteSousAgent('a1', 'x'));

    const rapport = await evaluerCompletude(arbre, new LecteurFactice(['x1']), 's1');

    expect(rapport.divergenceDetectee).toBe(false);
    expect(rapport.sousAgentsSansDetailTempsReel).toBe(0);
  });

  test('store absent (null) : sousAgentsConnusStore reste null, jamais confondu avec 0', async () => {
    const arbre = new ArbreFluxTempsReel();
    arbre.ingerer(dispatch('a1'));

    const rapport = await evaluerCompletude(arbre, null, 's1');

    expect(rapport.sousAgentsConnusStore).toBeNull();
    // Le flux seul suffit déjà à détecter la divergence (dispatché sans contenu).
    expect(rapport.divergenceDetectee).toBe(true);
  });

  test('store en panne : erreur absorbée, jamais levée, résultat traité comme "je ne sais pas"', async () => {
    const arbre = new ArbreFluxTempsReel();
    const rapport = await evaluerCompletude(arbre, new LecteurEnPanne(), 's1');
    expect(rapport.sousAgentsConnusStore).toBeNull();
  });
});
