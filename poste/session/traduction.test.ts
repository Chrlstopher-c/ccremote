import { describe, expect, test } from 'bun:test';
import { contexteDe, type Ligne, traduire, travailEnCours } from './traduction.ts';

const assistant = (content: object[], extra: object = {}): Ligne => ({
  type: 'assistant',
  isSidechain: false,
  message: {
    content,
    stop_reason: 'end_turn',
    usage: { input_tokens: 10, cache_read_input_tokens: 1000, cache_creation_input_tokens: 90 },
  },
  ...extra,
});

describe('traduction transcript → événements', () => {
  test('texte, réflexion et outil du fil principal', () => {
    expect(
      traduire(
        assistant([
          { type: 'thinking', thinking: 'je réfléchis' },
          { type: 'text', text: 'Bonjour' },
          { type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: 'git status' } },
        ]),
      ),
    ).toEqual([
      { type: 'reflexion', texte: 'je réfléchis' },
      { type: 'texte', texte: 'Bonjour' },
      { type: 'outil', id: 'toolu_1', nom: 'Bash', resume: 'git status', detail: '{\n "command": "git status"\n}' },
    ]);
  });

  test('une ligne de sous-agent n’entre pas dans le fil principal…', () => {
    expect(traduire(assistant([{ type: 'text', text: 'interne' }], { isSidechain: true }))).toEqual([]);
  });

  test('… mais se traduit, marquée, depuis le transcript du sous-agent', () => {
    expect(traduire(assistant([{ type: 'text', text: 'interne' }], { isSidechain: true }), 'toolu_9')).toEqual([
      { type: 'texte', texte: 'interne', agent: 'toolu_9' },
    ]);
  });

  test('les outils du harness sont tus', () => {
    expect(traduire(assistant([{ type: 'tool_use', name: 'mcp__ccremote__etape_terminee', input: {} }]))).toEqual([]);
  });

  test('sous-agent', () => {
    expect(
      traduire(
        assistant([{ type: 'tool_use', id: 't2', name: 'Agent', input: { description: 'explorer', model: 'sonnet' } }]),
      ),
    ).toEqual([{ type: 'sous_agent', id: 't2', description: 'explorer', modele: 'sonnet', genre: 'general-purpose' }]);
  });

  test('message tapé par Chris, commande, et bruit ignoré', () => {
    expect(traduire({ type: 'user', message: { content: 'Fais X' } })).toEqual([{ type: 'message', texte: 'Fais X' }]);
    expect(
      traduire({
        type: 'user',
        message: { content: '<command-name>/compact</command-name>\n<command-args>garde tout</command-args>' },
      }),
    ).toEqual([{ type: 'message', texte: '/compact garde tout' }]);
    expect(traduire({ type: 'user', message: { content: '<local-command-stdout>ok</local-command-stdout>' } })).toEqual(
      [],
    );
    expect(traduire({ type: 'user', isCompactSummary: true, message: { content: 'résumé' } })).toEqual([]);
  });

  test('résultat d’outil tronqué, erreur signalée', () => {
    expect(
      traduire({
        type: 'user',
        message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'x'.repeat(5000), is_error: true }] },
      }),
    ).toEqual([{ type: 'resultat_outil', outilId: 't1', extrait: 'x'.repeat(3000), erreur: true }]);
  });

  test('fin d’un sous-agent en arrière-plan (task-notification)', () => {
    const prompt =
      '<task-notification>\n<task-id>a1</task-id>\n<tool-use-id>toolu_7</tool-use-id>\n<status>completed</status>\n' +
      '<summary>Agent "x" finished</summary>\n</task-notification>';
    expect(traduire({ type: 'attachment', attachment: { type: 'queued_command', prompt } })).toEqual([
      { type: 'resultat_outil', outilId: 'toolu_7', extrait: 'Agent "x" finished', erreur: false },
    ]);
  });

  test('frontière de compaction (camelCase du transcript)', () => {
    expect(
      traduire({
        type: 'system',
        subtype: 'compact_boundary',
        compactMetadata: { trigger: 'manual', preTokens: 29954, postTokens: 3720 },
      }),
    ).toEqual([{ type: 'compaction', avant: 29954, apres: 3720, declencheur: 'manual' }]);
  });

  test('contexte et travail en cours', () => {
    expect(contexteDe(assistant([]))).toBe(1100);
    expect(travailEnCours(assistant([]))).toBe(false);
    expect(travailEnCours(assistant([], { message: { content: [], stop_reason: 'tool_use' } }))).toBe(true);
    expect(travailEnCours({ type: 'user', message: { content: 'go' } })).toBe(true);
  });
});
