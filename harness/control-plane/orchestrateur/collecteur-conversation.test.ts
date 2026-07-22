/**
 * Tests du collecteur de streaming : chaque bloc SDK (réflexion, texte, outil)
 * devient un événement distinct, et l'état de génération suit le tour.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { ouvrirRegistre, type Registre } from '../registre/index.ts';
import { CollecteurConversation } from './collecteur-conversation.ts';

let repertoire: string;
let registre: Registre;

function assistant(blocs: unknown[]): SDKMessage {
  return { type: 'assistant', message: { role: 'assistant', content: blocs } } as unknown as SDKMessage;
}
const RESULT = { type: 'result', subtype: 'success' } as unknown as SDKMessage;
const RESULT_ERREUR = { type: 'result', subtype: 'error_max_turns' } as unknown as SDKMessage;

beforeEach(() => {
  repertoire = mkdtempSync(join(tmpdir(), 'collecteur-test-'));
  registre = ouvrirRegistre({ chemin: join(repertoire, 'registre.sqlite') });
  registre.conversations.creer({ id: 'c', titre: 'C' });
});

afterEach(() => {
  registre.fermer();
  rmSync(repertoire, { recursive: true, force: true });
});

/** Fabrique un `stream_event` à la forme réelle du SDK (BetaRawMessageStreamEvent). */
function flux(event: unknown): SDKMessage {
  return { type: 'stream_event', event, parent_tool_use_id: null } as unknown as SDKMessage;
}

describe('CollecteurConversation — streaming token par token (le vrai défaut corrigé)', () => {
  test('les deltas de texte s’accumulent dans le bloc partiel, visibles avant la fin', () => {
    const col = new CollecteurConversation('c', registre.conversations);
    col.marquerEnvoi();
    col.ingerer(flux({ type: 'content_block_start', content_block: { type: 'text' } }));
    col.ingerer(flux({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'Bon' } }));
    expect(col.partiel).toEqual({ type: 'texte', contenu: 'Bon' });
    col.ingerer(flux({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'jour' } }));
    expect(col.partiel).toEqual({ type: 'texte', contenu: 'Bonjour' });
    // Rien n'est encore persisté : un INSERT par token noierait SQLite.
    expect(registre.conversations.evenements('c')).toHaveLength(0);
  });

  test('le bloc est persisté à content_block_stop, et le partiel se referme', () => {
    const col = new CollecteurConversation('c', registre.conversations);
    col.marquerEnvoi();
    col.ingerer(flux({ type: 'content_block_start', content_block: { type: 'text' } }));
    col.ingerer(flux({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'Bonjour' } }));
    col.ingerer(flux({ type: 'content_block_stop' }));
    expect(col.partiel).toBeNull();
    const evts = registre.conversations.evenements('c');
    expect(evts).toHaveLength(1);
    expect(evts[0]?.type).toBe('texte');
    expect(evts[0]?.contenu).toBe('Bonjour');
  });

  test('les deltas de réflexion produisent un bloc reflexion, pas du texte', () => {
    const col = new CollecteurConversation('c', registre.conversations);
    col.marquerEnvoi();
    col.ingerer(flux({ type: 'content_block_start', content_block: { type: 'thinking' } }));
    col.ingerer(flux({ type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 'hmm…' } }));
    expect(col.partiel?.type).toBe('reflexion');
    col.ingerer(flux({ type: 'content_block_stop' }));
    expect(registre.conversations.evenements('c')[0]?.type).toBe('reflexion');
  });

  test('un tool_use est persisté dès son début — le commentaire pendant la génération', () => {
    const col = new CollecteurConversation('c', registre.conversations);
    col.marquerEnvoi();
    col.ingerer(flux({ type: 'content_block_start', content_block: { type: 'tool_use', name: 'mcp__ctrl__lister' } }));
    const evts = registre.conversations.evenements('c');
    expect(evts).toHaveLength(1);
    expect(evts[0]?.type).toBe('outil');
    expect(evts[0]?.contenu).toBe('mcp__ctrl__lister');
  });

  test('☠ pas de double persistance : le message assistant complet est ignoré après streaming', () => {
    const col = new CollecteurConversation('c', registre.conversations);
    col.marquerEnvoi();
    col.ingerer(flux({ type: 'content_block_start', content_block: { type: 'text' } }));
    col.ingerer(flux({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'Bonjour' } }));
    col.ingerer(flux({ type: 'content_block_stop' }));
    col.ingerer(assistant([{ type: 'text', text: 'Bonjour' }]));
    expect(registre.conversations.evenements('c')).toHaveLength(1);
  });

  test('un delta sans content_block_start ouvre le bloc à la volée, aucun texte perdu', () => {
    const col = new CollecteurConversation('c', registre.conversations);
    col.marquerEnvoi();
    col.ingerer(flux({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'orphelin' } }));
    expect(col.partiel).toEqual({ type: 'texte', contenu: 'orphelin' });
  });

  test('un result finalise un bloc resté ouvert plutôt que de le perdre', () => {
    const col = new CollecteurConversation('c', registre.conversations);
    col.marquerEnvoi();
    col.ingerer(flux({ type: 'content_block_start', content_block: { type: 'text' } }));
    col.ingerer(flux({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'inachevé' } }));
    col.ingerer(RESULT);
    const types = registre.conversations.evenements('c').map((e) => e.type);
    expect(types).toEqual(['texte', 'resultat']);
    expect(col.partiel).toBeNull();
  });
});

describe('CollecteurConversation', () => {
  test('éclate un message en blocs typés distincts, dans l’ordre', () => {
    const col = new CollecteurConversation('c', registre.conversations);
    col.marquerEnvoi();
    col.ingerer(assistant([
      { type: 'thinking', thinking: 'je réfléchis' },
      { type: 'tool_use', name: 'mcp__controle__lister_parc', input: {} },
      { type: 'text', text: 'Voici le point.' },
    ]));
    const types = registre.conversations.evenements('c').map((e) => `${e.type}:${e.contenu}`);
    expect(types).toEqual(['reflexion:je réfléchis', 'outil:mcp__controle__lister_parc', 'texte:Voici le point.']);
  });

  test('marque la fin de génération au result et pousse un événement resultat', () => {
    const col = new CollecteurConversation('c', registre.conversations);
    col.marquerEnvoi();
    expect(col.genere).toBe(true);
    col.ingerer(assistant([{ type: 'text', text: 'ok' }]));
    col.ingerer(RESULT);
    expect(col.genere).toBe(false);
    const derniers = registre.conversations.evenements('c');
    expect(derniers.at(-1)?.type).toBe('resultat');
  });

  test('un result en erreur pousse un événement erreur, jamais resultat', () => {
    const col = new CollecteurConversation('c', registre.conversations);
    col.marquerEnvoi();
    col.ingerer(RESULT_ERREUR);
    expect(col.genere).toBe(false);
    expect(registre.conversations.evenements('c').at(-1)?.type).toBe('erreur');
  });

  test('ignore les blocs vides et ne lève jamais sur un message inconnu', () => {
    const col = new CollecteurConversation('c', registre.conversations);
    expect(() => col.ingerer({ type: 'system' } as unknown as SDKMessage)).not.toThrow();
    col.ingerer(assistant([{ type: 'text', text: '' }]));
    expect(registre.conversations.evenements('c')).toHaveLength(0);
  });
});
