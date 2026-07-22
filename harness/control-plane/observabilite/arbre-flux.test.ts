// Tests de la reconstruction d'arbre depuis le flux SDK (M-50, E.2.1/E.2.2).
// Messages synthétiques — jamais de vraie session Claude Code ici (règle du dépôt).

import { describe, expect, test } from 'bun:test';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { ArbreFluxTempsReel, OUTIL_DELEGATION } from './arbre-flux.ts';
import { RACINE_FLUX } from './types.ts';

/** Construit un message `assistant` synthétique, sonde structurelle du SDK. */
function assistant(parentToolUseId: string | null, contenu: unknown[]): SDKMessage {
  return {
    type: 'assistant',
    parent_tool_use_id: parentToolUseId,
    message: { content: contenu },
    uuid: 'u1',
    session_id: 's1',
  } as unknown as SDKMessage;
}

function utilisateur(parentToolUseId: string | null, contenu: unknown[]): SDKMessage {
  return {
    type: 'user',
    parent_tool_use_id: parentToolUseId,
    message: { content: contenu },
    uuid: 'u2',
    session_id: 's1',
  } as unknown as SDKMessage;
}

function streamEvent(parentToolUseId: string | null, texte: string): SDKMessage {
  return {
    type: 'stream_event',
    parent_tool_use_id: parentToolUseId,
    event: { type: 'content_block_delta', delta: { type: 'text_delta', text: texte } },
    uuid: 'u3',
    session_id: 's1',
  } as unknown as SDKMessage;
}

function tacheProgres(toolUseId: string, summary: string | undefined, lastTool: string | undefined): SDKMessage {
  return {
    type: 'system',
    subtype: 'task_progress',
    tool_use_id: toolUseId,
    task_id: 'task-1',
    summary,
    last_tool_name: lastTool,
    usage: { total_tokens: 1, tool_uses: 1, duration_ms: 1 },
    uuid: 'u4',
    session_id: 's1',
  } as unknown as SDKMessage;
}

describe('ArbreFluxTempsReel — granularité tokens (E.2.1)', () => {
  test('un stream_event de la racine accumule le texte de la ligne principale', () => {
    const arbre = new ArbreFluxTempsReel();
    const fragments = arbre.ingerer(streamEvent(null, 'bonjour'));
    expect(fragments).toEqual([{ ligneId: RACINE_FLUX, granularite: 'tokens', texte: 'bonjour' }]);
    expect(arbre.ligne(RACINE_FLUX)?.texteAccumule).toBe('bonjour');
  });
});

describe('ArbreFluxTempsReel — granularité activité sous-agent (E.2.1)', () => {
  test('un tool_use Agent dispatché depuis la racine crée une ligne enfant', () => {
    const arbre = new ArbreFluxTempsReel();
    arbre.ingerer(assistant(null, [{ type: 'tool_use', id: 'call-1', name: OUTIL_DELEGATION }]));
    const ligne = arbre.ligne('call-1');
    expect(ligne).toBeDefined();
    expect(ligne?.parentId).toBe(RACINE_FLUX);
    expect(ligne?.profondeur).toBe(1);
    expect(arbre.sousAgentsDispatches()).toBe(1);
  });

  test('un outil nommé Task (piège H-72.3) n\'est PAS traité comme une délégation', () => {
    const arbre = new ArbreFluxTempsReel();
    arbre.ingerer(assistant(null, [{ type: 'tool_use', id: 'call-1', name: 'Task' }]));
    expect(arbre.sousAgentsDispatches()).toBe(0);
  });

  test('le texte forwardé (parent_tool_use_id renseigné) alimente la ligne du sous-agent', () => {
    const arbre = new ArbreFluxTempsReel();
    arbre.ingerer(assistant(null, [{ type: 'tool_use', id: 'call-1', name: OUTIL_DELEGATION }]));
    const fragments = arbre.ingerer(assistant('call-1', [{ type: 'text', text: 'je travaille' }]));
    expect(fragments).toEqual([{ ligneId: 'call-1', granularite: 'activite_sous_agent', texte: 'je travaille' }]);
    expect(arbre.ligne('call-1')?.texteAccumule).toBe('je travaille');
    expect(arbre.sousAgentsAvecContenu()).toBe(1);
  });

  test('un tool_result apparié par tool_use_id termine la ligne du sous-agent', () => {
    const arbre = new ArbreFluxTempsReel();
    arbre.ingerer(assistant(null, [{ type: 'tool_use', id: 'call-1', name: OUTIL_DELEGATION }]));
    arbre.ingerer(utilisateur(null, [{ type: 'tool_result', tool_use_id: 'call-1' }]));
    expect(arbre.ligne('call-1')?.statut).toBe('terminee');
  });
});

describe('ArbreFluxTempsReel — granularité résumé (E.2.1)', () => {
  test('un task_progress avec summary compte comme contenu et alimente le fil', () => {
    const arbre = new ArbreFluxTempsReel();
    arbre.ingerer(assistant(null, [{ type: 'tool_use', id: 'call-1', name: OUTIL_DELEGATION }]));
    const fragments = arbre.ingerer(tacheProgres('call-1', 'a fini de lire les fichiers', 'Read'));
    expect(fragments).toEqual([{ ligneId: 'call-1', granularite: 'resume', texte: 'a fini de lire les fichiers' }]);
    expect(arbre.ligne('call-1')?.dernierResume).toBe('a fini de lire les fichiers');
    expect(arbre.ligne('call-1')?.dernierOutil).toBe('Read');
    expect(arbre.sousAgentsAvecContenu()).toBe(1);
  });

  test('un task_progress SANS summary ne compte pas comme contenu vu (H-72.3 : ligne à 0 caractère)', () => {
    const arbre = new ArbreFluxTempsReel();
    arbre.ingerer(assistant(null, [{ type: 'tool_use', id: 'call-1', name: OUTIL_DELEGATION }]));
    const fragments = arbre.ingerer(tacheProgres('call-1', undefined, undefined));
    expect(fragments).toEqual([]);
    expect(arbre.sousAgentsAvecContenu()).toBe(0);
    expect(arbre.sousAgentsDispatches()).toBe(1);
  });
});

describe('ArbreFluxTempsReel — mesure H-72.3 reproduite (3 à 4 lignes sur 5)', () => {
  test('un sous-agent jamais vu dans le flux reste dispatché mais sans contenu', () => {
    const arbre = new ArbreFluxTempsReel();
    for (const id of ['call-1', 'call-2', 'call-3', 'call-4', 'call-5']) {
      arbre.ingerer(assistant(null, [{ type: 'tool_use', id, name: OUTIL_DELEGATION }]));
    }
    // Seuls 3 des 5 produisent du contenu réel — reproduit la mesure du banc réel.
    arbre.ingerer(assistant('call-1', [{ type: 'text', text: 'a' }]));
    arbre.ingerer(assistant('call-2', [{ type: 'text', text: 'b' }]));
    arbre.ingerer(tacheProgres('call-3', 'résumé', 'Read'));
    expect(arbre.sousAgentsDispatches()).toBe(5);
    expect(arbre.sousAgentsAvecContenu()).toBe(3);
    // call-4 et call-5 existent bien (jamais omis) mais sans contenu.
    expect(arbre.ligne('call-4')).toBeDefined();
    expect(arbre.ligne('call-5')).toBeDefined();
  });
});

describe('ArbreFluxTempsReel — robustesse', () => {
  test('un message malformé ne fait jamais lever ingerer()', () => {
    const arbre = new ArbreFluxTempsReel();
    const casse = { type: 'assistant', parent_tool_use_id: null, message: null, uuid: 'x', session_id: 's' } as unknown as SDKMessage;
    expect(() => arbre.ingerer(casse)).not.toThrow();
  });
});
