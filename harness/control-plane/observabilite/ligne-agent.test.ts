// Tests de la vue « clic sur un sous-agent » (H-72.1 point 3, mission M-50).
// Ne réimplémente pas listSubagents/getSubagentMessages (E.2.2) : ce module
// se contente de les composer — les doublures ci-dessous jouent leur rôle.

import { describe, expect, test } from 'bun:test';
import type { SessionMessage } from '@anthropic-ai/claude-agent-sdk';
import { chargerLigneAgent, ErreurLigneAgent, listerSousAgentsConnus } from './ligne-agent.ts';
import type { LecteurSousAgents } from './types.ts';

function message(sessionId: string, parentAgentId: string | null): SessionMessage {
  return { type: 'assistant', uuid: 'u', session_id: sessionId, message: {}, parent_tool_use_id: null, parent_agent_id: parentAgentId };
}

class LecteurFactice implements LecteurSousAgents {
  constructor(
    private readonly agents: readonly string[],
    private readonly parentDe: Record<string, string | null>,
  ) {}
  async listerSousAgents(): Promise<readonly string[]> {
    return this.agents;
  }
  async chargerMessagesAgent(sessionId: string, agentId: string): Promise<readonly SessionMessage[]> {
    const parent = this.parentDe[agentId] ?? null;
    return [message(sessionId, parent)];
  }
}

class LecteurEnPanne implements LecteurSousAgents {
  async listerSousAgents(): Promise<readonly string[]> {
    return ['a1'];
  }
  async chargerMessagesAgent(): Promise<readonly SessionMessage[]> {
    throw new Error('disque indisponible');
  }
}

describe('chargerLigneAgent', () => {
  test('charge un sous-agent de premier niveau sans enfant', async () => {
    const lecteur = new LecteurFactice(['a1'], { a1: null });
    const noeud = await chargerLigneAgent(lecteur, 's1', 'a1');
    expect(noeud.agentId).toBe('a1');
    expect(noeud.parentAgentId).toBeNull();
    expect(noeud.enfants).toHaveLength(0);
  });

  test('reconstruit la nidification via parent_agent_id (nidification profonde, E.2.2)', async () => {
    const lecteur = new LecteurFactice(['a1', 'a2', 'a3'], { a1: null, a2: 'a1', a3: 'a2' });
    const noeud = await chargerLigneAgent(lecteur, 's1', 'a1');
    expect(noeud.enfants).toHaveLength(1);
    expect(noeud.enfants[0]?.agentId).toBe('a2');
    expect(noeud.enfants[0]?.enfants).toHaveLength(1);
    expect(noeud.enfants[0]?.enfants[0]?.agentId).toBe('a3');
  });

  test('un sous-agent sans lien de parenté connu n\'est jamais rattaché par erreur', async () => {
    const lecteur = new LecteurFactice(['a1', 'a2'], { a1: null, a2: null });
    const noeud = await chargerLigneAgent(lecteur, 's1', 'a1');
    expect(noeud.enfants).toHaveLength(0);
  });

  test('une erreur de lecture ne fuit jamais telle quelle — remontée typée', async () => {
    await expect(chargerLigneAgent(new LecteurEnPanne(), 's1', 'a1')).rejects.toThrow(ErreurLigneAgent);
  });
});

describe('listerSousAgentsConnus', () => {
  test('retourne la liste plate des agentId connus du store', async () => {
    const lecteur = new LecteurFactice(['a1', 'a2'], {});
    expect(await listerSousAgentsConnus(lecteur, 's1')).toEqual(['a1', 'a2']);
  });

  test('une panne de listage ne lève jamais — liste vide en repli', async () => {
    class Panne implements LecteurSousAgents {
      async listerSousAgents(): Promise<readonly string[]> {
        throw new Error('panne');
      }
      async chargerMessagesAgent(): Promise<readonly SessionMessage[]> {
        return [];
      }
    }
    expect(await listerSousAgentsConnus(new Panne(), 's1')).toEqual([]);
  });
});
