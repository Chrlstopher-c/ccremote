// Responsabilité : les deltas d'un flux repris sans message_start restent dans leur bloc (texte et réflexion d'un même
// index dans deux messages ne se mêlent pas : un texte écrit entre deux appels d'outils ne devient pas une réflexion).
/// <reference types="bun" />
import { describe, expect, test } from 'bun:test';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { nouvelEtatTraduction, traduireSdk } from './traduction-sdk.ts';

function flux(event: Record<string, unknown>): SDKMessage {
  return { type: 'stream_event', event, parent_tool_use_id: null, session_id: 's', uuid: 'x' } as unknown as SDKMessage;
}

describe('flux repris sans message_start', () => {
  test('réflexion puis texte, tous deux à l’index 0 : deux blocs distincts', () => {
    const etat = nouvelEtatTraduction();
    const evts = [
      flux({ type: 'content_block_start', index: 0, content_block: { type: 'thinking' } }),
      flux({ type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'je réfléchis' } }),
      flux({ type: 'content_block_start', index: 0, content_block: { type: 'text' } }),
      flux({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Je lance la commande' } }),
    ].flatMap((m) => traduireSdk(m, etat).evenements);
    const blocs = evts.map((e) => (e.type === 'flux' ? [e.bloc, e.genre ?? 'texte'] : null));
    expect(blocs[0]?.[1]).toBe('reflexion');
    expect(blocs[1]?.[0]).not.toBe(blocs[0]?.[0]);
    expect(blocs[1]?.[1]).toBe('texte');
  });

  test('avec message_start : clé par identifiant de message, inchangée', () => {
    const etat = nouvelEtatTraduction();
    const evts = [
      flux({ type: 'message_start', message: { id: 'msg_A' } }),
      flux({ type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'a' } }),
    ].flatMap((m) => traduireSdk(m, etat).evenements);
    expect(evts[0]).toMatchObject({ type: 'flux', bloc: 'msg_A:1' });
  });
});
