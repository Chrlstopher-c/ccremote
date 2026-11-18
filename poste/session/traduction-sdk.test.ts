// Responsabilité : tests de la traduction des messages du Claude Agent SDK en événements du fil.
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { describe, expect, test } from 'bun:test';
import { nouvelEtatTraduction, traduireSdk } from './traduction-sdk.ts';

// Fixtures partielles : seuls les champs lus par la traduction sont renseignés. Le cast ne sert qu'aux tests.
const sdk = (m: object): SDKMessage => m as SDKMessage;

const usage = { input_tokens: 10, cache_read_input_tokens: 1000, cache_creation_input_tokens: 90, output_tokens: 5 };

const assistant = (content: object[], extra: object = {}): SDKMessage =>
  sdk({
    type: 'assistant',
    session_id: 's1',
    uuid: 'u1',
    parent_tool_use_id: null,
    message: { id: 'msg_1', role: 'assistant', content, usage },
    ...extra,
  });

const utilisateur = (content: unknown, parent: string | null = null): SDKMessage =>
  sdk({ type: 'user', session_id: 's1', parent_tool_use_id: parent, message: { role: 'user', content } });

const resultatOk = (extra: object = {}): SDKMessage =>
  sdk({
    type: 'result',
    subtype: 'success',
    session_id: 's1',
    duration_ms: 4200,
    duration_api_ms: 3900,
    is_error: false,
    num_turns: 1,
    result: 'fini',
    stop_reason: 'end_turn',
    total_cost_usd: 0.01,
    usage,
    permission_denials: [],
    uuid: 'r1',
    ...extra,
  });

describe('traduction SDK → événements', () => {
  test('texte, réflexion et outil Bash du fil principal, dans l’ordre des blocs', () => {
    const sortie = traduireSdk(
      assistant([
        { type: 'thinking', thinking: 'je réfléchis', signature: 'x' },
        { type: 'text', text: 'Bonjour' },
        { type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: 'git status' } },
      ]),
      nouvelEtatTraduction(),
    );
    expect(sortie.evenements).toEqual([
      { type: 'reflexion', texte: 'je réfléchis' },
      { type: 'texte', texte: 'Bonjour', uuid: 'u1' },
      { type: 'outil', id: 'toolu_1', nom: 'Bash', resume: 'git status', detail: '{\n "command": "git status"\n}' },
    ]);
    expect(sortie.claudeSessionId).toBe('s1');
  });

  test('outil Edit : résumé sur file_path, détail JSON complet', () => {
    const entree = { file_path: '/a/b.ts', old_string: 'x', new_string: 'y' };
    expect(
      traduireSdk(assistant([{ type: 'tool_use', id: 't2', name: 'Edit', input: entree }]), nouvelEtatTraduction())
        .evenements,
    ).toEqual([{ type: 'outil', id: 't2', nom: 'Edit', resume: '/a/b.ts', detail: JSON.stringify(entree, null, 1) }]);
  });

  test('sous-agent Task : outil marqué et sous_agent (description, modèle, genre)', () => {
    const entree = { description: 'explorer', model: 'sonnet', subagent_type: 'Explore', prompt: 'cherche' };
    const evenements = traduireSdk(
      assistant([{ type: 'tool_use', id: 't3', name: 'Task', input: entree }]),
      nouvelEtatTraduction(),
    ).evenements;
    expect(evenements).toEqual([
      { type: 'outil', id: 't3', nom: 'Task', resume: JSON.stringify(entree), detail: JSON.stringify(entree, null, 1) },
      { type: 'sous_agent', id: 't3', description: 'explorer', modele: 'sonnet', genre: 'Explore' },
    ]);
  });

  test('texte du sous-agent : porte l’id de l’appel Task dans `agent`', () => {
    const sortie = traduireSdk(
      assistant([{ type: 'text', text: 'interne' }], { parent_tool_use_id: 't3' }),
      nouvelEtatTraduction(),
    );
    expect(sortie.evenements).toEqual([{ type: 'texte', texte: 'interne', agent: 't3' }]);
  });

  test('les outils du harness ccremote sont tus', () => {
    const outil = { type: 'tool_use', id: 't4', name: 'mcp__ccremote__etape_terminee', input: {} };
    expect(traduireSdk(assistant([outil]), nouvelEtatTraduction()).evenements).toEqual([]);
  });

  test('résultat d’outil : extrait tronqué à 3000 caractères', () => {
    const sortie = traduireSdk(
      utilisateur([{ type: 'tool_result', tool_use_id: 't1', content: 'x'.repeat(5000) }]),
      nouvelEtatTraduction(),
    );
    expect(sortie.evenements).toEqual([
      { type: 'resultat_outil', outilId: 't1', extrait: 'x'.repeat(3000), erreur: false },
    ]);
  });

  test('résultat d’outil en erreur, contenu en blocs texte', () => {
    const contenu = [
      { type: 'text', text: 'commande' },
      { type: 'text', text: 'introuvable' },
    ];
    const sortie = traduireSdk(
      utilisateur([{ type: 'tool_result', tool_use_id: 't5', content: contenu, is_error: true }]),
      nouvelEtatTraduction(),
    );
    expect(sortie.evenements).toEqual([
      { type: 'resultat_outil', outilId: 't5', extrait: 'commande\nintrouvable', erreur: true },
    ]);
  });

  test('résultat d’un sous-agent : porte `agent`', () => {
    const sortie = traduireSdk(
      utilisateur([{ type: 'tool_result', tool_use_id: 't6', content: 'ok' }], 't3'),
      nouvelEtatTraduction(),
    );
    expect(sortie.evenements).toEqual([
      { type: 'resultat_outil', outilId: 't6', extrait: 'ok', erreur: false, agent: 't3' },
    ]);
  });

  test('message texte de Chris (non résultat) : rien, il arrive par un autre canal', () => {
    expect(traduireSdk(utilisateur('Fais X'), nouvelEtatTraduction()).evenements).toEqual([]);
  });

  test('flux partiel : message_start puis text_delta → flux sur le bloc message:index', () => {
    const etat = nouvelEtatTraduction();
    const debut = sdk({
      type: 'stream_event',
      session_id: 's1',
      parent_tool_use_id: null,
      event: { type: 'message_start', message: { id: 'msg_9' } },
    });
    const delta = sdk({
      type: 'stream_event',
      session_id: 's1',
      parent_tool_use_id: null,
      event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Sal' } },
    });
    expect(traduireSdk(debut, etat).evenements).toEqual([]);
    expect(traduireSdk(delta, etat).evenements).toEqual([{ type: 'flux', bloc: 'msg_9:0', delta: 'Sal' }]);
  });

  test('flux partiel : les autres événements de stream sont ignorés', () => {
    const etat = nouvelEtatTraduction();
    const json = sdk({
      type: 'stream_event',
      session_id: 's1',
      parent_tool_use_id: null,
      event: { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{' } },
    });
    const arret = sdk({
      type: 'stream_event',
      session_id: 's1',
      parent_tool_use_id: null,
      event: { type: 'message_stop' },
    });
    expect(traduireSdk(json, etat).evenements).toEqual([]);
    expect(traduireSdk(arret, etat).evenements).toEqual([]);
  });

  test('flux partiel d’un sous-agent : porte `agent`', () => {
    const etat = nouvelEtatTraduction();
    const delta = sdk({
      type: 'stream_event',
      session_id: 's1',
      parent_tool_use_id: 't3',
      event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'ok' } },
    });
    expect(traduireSdk(delta, etat).evenements).toEqual([{ type: 'flux', bloc: '0:0', delta: 'ok', agent: 't3' }]);
  });

  test('result succès : tour_fini, fin de tour avec le contexte du dernier appel', () => {
    const etat = nouvelEtatTraduction();
    traduireSdk(assistant([{ type: 'text', text: 'fin' }]), etat);
    const sortie = traduireSdk(resultatOk(), etat);
    expect(sortie.evenements).toEqual([{ type: 'tour_fini', dureeMs: 4200, contexte: 1100, entree: 1100, sortie: 5 }]);
    expect(sortie.finDeTour).toEqual({ dureeMs: 4200, contexte: 1100, erreur: null });
  });

  test('result en erreur : erreur et fin de tour portant le message', () => {
    const sortie = traduireSdk(
      sdk({
        type: 'result',
        subtype: 'error_max_turns',
        session_id: 's1',
        duration_ms: 900,
        duration_api_ms: 800,
        is_error: true,
        num_turns: 30,
        stop_reason: null,
        total_cost_usd: 0,
        usage,
        permission_denials: [],
        errors: ['trop de tours'],
        uuid: 'r2',
      }),
      nouvelEtatTraduction(),
    );
    expect(sortie.evenements).toEqual([
      { type: 'erreur', message: 'trop de tours' },
      { type: 'tour_fini', dureeMs: 900, contexte: 0, entree: 1100, sortie: 5 },
    ]);
    expect(sortie.finDeTour).toEqual({ dureeMs: 900, contexte: 0, erreur: 'trop de tours' });
  });

  test('erreur d’API sur le fil principal : une seule erreur, le result ne la répète pas', () => {
    const etat = nouvelEtatTraduction();
    const erreur = assistant([{ type: 'text', text: 'API Error: 429' }], { error: 'rate_limit' });
    expect(traduireSdk(erreur, etat).evenements).toEqual([{ type: 'erreur', message: 'API Error: 429' }]);
    const fin = traduireSdk(resultatOk({ is_error: true, result: 'API Error: 429' }), etat);
    expect(fin.evenements.filter((e) => e.type === 'erreur')).toEqual([]);
    expect(fin.finDeTour?.erreur).toBe('API Error: 429');
  });

  test('system init : identifiant de session, aucun événement', () => {
    const sortie = traduireSdk(
      sdk({ type: 'system', subtype: 'init', session_id: 'claude-42', model: 'claude-haiku-5-5', cwd: '/x' }),
      nouvelEtatTraduction(),
    );
    expect(sortie).toEqual({ evenements: [], claudeSessionId: 'claude-42' });
  });

  test('system compact_boundary : événement compaction et drapeau', () => {
    const sortie = traduireSdk(
      sdk({
        type: 'system',
        subtype: 'compact_boundary',
        session_id: 's1',
        compact_metadata: { trigger: 'auto', pre_tokens: 180000, post_tokens: 22000 },
      }),
      nouvelEtatTraduction(),
    );
    expect(sortie.evenements).toEqual([{ type: 'compaction', avant: 180000, apres: 22000, declencheur: 'auto' }]);
    expect(sortie.compaction).toBe(true);
  });

  test('system status compacting : drapeau seul, pas de doublon d’événement', () => {
    const sortie = traduireSdk(
      sdk({ type: 'system', subtype: 'status', status: 'compacting', session_id: 's1' }),
      nouvelEtatTraduction(),
    );
    expect(sortie.evenements).toEqual([]);
    expect(sortie.compaction).toBe(true);
  });

  test('messages inconnus ou incomplets : sortie vide, sans exception', () => {
    const etat = nouvelEtatTraduction();
    expect(traduireSdk(sdk({ type: 'rate_limit_event', session_id: 's1' }), etat)).toEqual({
      evenements: [],
      claudeSessionId: 's1',
    });
    expect(traduireSdk(sdk({ type: 'system', subtype: 'hook_started' }), etat)).toEqual({ evenements: [] });
    expect(traduireSdk(sdk({}), etat)).toEqual({ evenements: [] });
    expect(traduireSdk(assistant([{ type: 'inconnu' }, { type: 'tool_use' }]), etat).evenements).toEqual([]);
  });
});

describe('flux de réflexion', () => {
  test('thinking_delta → flux de genre réflexion, text_delta reste un flux de texte', () => {
    const etat = nouvelEtatTraduction();
    const pense = sdk({
      type: 'stream_event',
      session_id: 's1',
      parent_tool_use_id: null,
      event: { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'je pèse' } },
    });
    const dit = sdk({
      type: 'stream_event',
      session_id: 's1',
      parent_tool_use_id: null,
      event: { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'Bon' } },
    });
    expect(traduireSdk(pense, etat).evenements).toEqual([
      { type: 'flux', bloc: '0:0', delta: 'je pèse', genre: 'reflexion' },
    ]);
    expect(traduireSdk(dit, etat).evenements).toEqual([{ type: 'flux', bloc: '1:1', delta: 'Bon' }]);
  });
});
