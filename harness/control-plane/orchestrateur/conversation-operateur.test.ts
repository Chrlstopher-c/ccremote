import { describe, expect, test } from 'bun:test';
import { ConversationOperateur, ConversationEnCoursError } from './conversation-operateur.ts';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';

function msgAssistant(texte: string): SDKMessage {
  return { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: texte }] } } as unknown as SDKMessage;
}
const RESULT = { type: 'result' } as unknown as SDKMessage;

describe('ConversationOperateur', () => {
  test('assemble le texte assistant jusqu’au result et le rend', async () => {
    const envoyes: string[] = [];
    const conv = new ConversationOperateur({ envoyerOperateur: async (t) => { envoyes.push(t); } });
    const p = conv.envoyer('salut');
    conv.ingerer(msgAssistant('Bon'));
    conv.ingerer(msgAssistant('jour'));
    conv.ingerer(RESULT);
    expect(await p).toBe('Bonjour');
    expect(envoyes).toEqual(['salut']);
  });

  test('☠ un second envoi pendant un tour en cours est REJETÉ, jamais mis en file en douce', async () => {
    const conv = new ConversationOperateur({ envoyerOperateur: async () => {} });
    void conv.envoyer('un');
    await expect(conv.envoyer('deux')).rejects.toThrow(ConversationEnCoursError);
  });

  test('☠ timeout : jamais de promesse suspendue à vie si aucun result n’arrive', async () => {
    const conv = new ConversationOperateur({ envoyerOperateur: async () => {} }, 50);
    await expect(conv.envoyer('x')).rejects.toThrow(/aucune réponse/);
  });

  test('un message vide n’est jamais envoyé', async () => {
    const conv = new ConversationOperateur({ envoyerOperateur: async () => {} });
    await expect(conv.envoyer('   ')).rejects.toThrow(RangeError);
  });

  test('ingerer hors tour ne lève jamais', () => {
    const conv = new ConversationOperateur({ envoyerOperateur: async () => {} });
    expect(() => conv.ingerer(RESULT)).not.toThrow();
  });
});
