// Responsabilité : tests de la traduction des messages du Claude Agent SDK en événements du fil.
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { describe, expect, test } from 'bun:test';
import { nouvelEtatTraduction, type SortieTraduction, traduireSdk } from './traduction-sdk.ts';

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

  test('TodoWrite : liste de tâches du fil principal, sans carte d’outil ; statuts traduits', () => {
    const sortie = traduireSdk(
      assistant([
        {
          type: 'tool_use',
          id: 'td1',
          name: 'TodoWrite',
          input: {
            todos: [
              { content: 'Lire le code', status: 'completed', activeForm: 'Lisant' },
              { content: 'Écrire le test', status: 'in_progress', activeForm: 'Écrivant' },
              { content: 'Pousser', status: 'pending', activeForm: 'Poussant' },
              { content: '   ', status: 'pending' },
            ],
          },
        },
      ]),
      nouvelEtatTraduction(),
    );
    expect(sortie.evenements).toEqual([
      {
        type: 'taches',
        taches: [
          { contenu: 'Lire le code', etat: 'fait' },
          { contenu: 'Écrire le test', etat: 'en_cours' },
          { contenu: 'Pousser', etat: 'attente' },
        ],
      },
    ]);
  });

  test('TodoWrite d’un sous-agent : pas de liste (seul le fil principal la porte)', () => {
    const sortie = traduireSdk(
      assistant([{ type: 'tool_use', id: 'td2', name: 'TodoWrite', input: { todos: [] } }], {
        parent_tool_use_id: 'p1',
      }),
      nouvelEtatTraduction(),
    );
    expect(sortie.evenements.some((e) => e.type === 'taches')).toBe(false);
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
    expect(sortie.evenements).toEqual([
      { type: 'tour_fini', dureeMs: 4200, contexte: 1100, entree: 1100, sortie: 5, uuid: 'u1' },
    ]);
    expect(sortie.finDeTour).toEqual({ dureeMs: 4200, contexte: 1100, erreur: null });
  });

  test('tour_fini porte la dernière entrée assistant du fil principal, pas celle d’un sous-agent', () => {
    const etat = nouvelEtatTraduction();
    traduireSdk(assistant([{ type: 'text', text: 'avant' }]), etat);
    traduireSdk(assistant([{ type: 'text', text: 'fin' }], { uuid: 'u2' }), etat);
    traduireSdk(assistant([{ type: 'text', text: 'agent' }], { uuid: 'u3', parent_tool_use_id: 'toolu_9' }), etat);
    const premier = traduireSdk(resultatOk(), etat).evenements;
    expect(premier.at(-1)).toMatchObject({ type: 'tour_fini', uuid: 'u2' });
    expect(traduireSdk(resultatOk(), etat).evenements.at(-1)).not.toHaveProperty('uuid');
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

describe('liste de tâches du SDK (TaskCreate / TaskUpdate)', () => {
  const creer = (id: string, subject: string): SDKMessage =>
    assistant([{ type: 'tool_use', id, name: 'TaskCreate', input: { subject, description: subject } }]);
  const resultatCreation = (id: string, texte: string): SDKMessage =>
    utilisateur([{ type: 'tool_result', tool_use_id: id, content: texte }]);
  const miseAJour = (id: string, taskId: string, status: string): SDKMessage =>
    assistant([{ type: 'tool_use', id, name: 'TaskUpdate', input: { taskId, status } }]);

  test('trois créations : id du résultat, ordre de création, pas de carte d’outil ni de résultat affiché', () => {
    const etat = nouvelEtatTraduction();
    const sorties = [
      traduireSdk(creer('c1', 'Lire'), etat),
      traduireSdk(resultatCreation('c1', 'Task #1 created successfully: Lire'), etat),
      traduireSdk(creer('c2', 'Écrire'), etat),
      traduireSdk(resultatCreation('c2', 'Task #2 created successfully: Écrire'), etat),
      traduireSdk(creer('c3', 'Tester'), etat),
      traduireSdk(resultatCreation('c3', 'Task #3 created successfully: Tester'), etat),
    ];
    expect(sorties.map((s) => s.evenements.length)).toEqual([0, 1, 0, 1, 0, 1]);
    expect(sorties[5]?.evenements).toEqual([
      {
        type: 'taches',
        taches: [
          { contenu: 'Lire', etat: 'attente' },
          { contenu: 'Écrire', etat: 'attente' },
          { contenu: 'Tester', etat: 'attente' },
        ],
      },
    ]);
  });

  test('TaskUpdate : passage en cours puis fait, émis à chaque changement', () => {
    const etat = nouvelEtatTraduction();
    traduireSdk(creer('c1', 'Lire'), etat);
    traduireSdk(resultatCreation('c1', 'Task #1 created'), etat);
    expect(traduireSdk(miseAJour('u1', '1', 'in_progress'), etat).evenements).toEqual([
      { type: 'taches', taches: [{ contenu: 'Lire', etat: 'en_cours' }] },
    ]);
    expect(traduireSdk(miseAJour('u2', '1', 'completed'), etat).evenements).toEqual([
      { type: 'taches', taches: [{ contenu: 'Lire', etat: 'fait' }] },
    ]);
  });

  test('résultat sans id : numérotation dans l’ordre de création ; TaskUpdate sur id inconnu ignoré', () => {
    const etat = nouvelEtatTraduction();
    traduireSdk(creer('c1', 'A'), etat);
    traduireSdk(resultatCreation('c1', 'ok'), etat);
    expect(traduireSdk(miseAJour('u1', '99', 'completed'), etat).evenements).toEqual([]);
    expect(traduireSdk(miseAJour('u2', '1', 'completed'), etat).evenements).toEqual([
      { type: 'taches', taches: [{ contenu: 'A', etat: 'fait' }] },
    ]);
  });

  test('scénario complet : 3 tâches créées, passées en cours puis fait, toutes terminées', () => {
    const etat = nouvelEtatTraduction();
    const noms = ['Créer', 'Remplir', 'Vérifier'];
    noms.forEach((nom, i) => {
      traduireSdk(creer(`c${i}`, nom), etat);
      traduireSdk(resultatCreation(`c${i}`, `Task #${i + 1} created`), etat);
    });
    let derniere: SortieTraduction | undefined;
    for (let i = 1; i <= 3; i++) {
      traduireSdk(miseAJour(`ec${i}`, String(i), 'in_progress'), etat);
      derniere = traduireSdk(miseAJour(`fc${i}`, String(i), 'completed'), etat);
    }
    expect(derniere?.evenements).toEqual([
      {
        type: 'taches',
        taches: noms.map((contenu) => ({ contenu, etat: 'fait' })),
      },
    ]);
  });

  test('TaskCreate d’un sous-agent : pas de liste du fil principal', () => {
    const etat = nouvelEtatTraduction();
    const sortie = traduireSdk(
      assistant([{ type: 'tool_use', id: 's1', name: 'TaskCreate', input: { subject: 'x', description: 'x' } }], {
        parent_tool_use_id: 'p1',
      }),
      etat,
    );
    expect(sortie.evenements.some((e) => e.type === 'taches')).toBe(false);
    expect(etat.taches).toEqual([]);
  });
});

describe('quota vu dans le flux SDK (rate_limit_event)', () => {
  test('fenêtre de session : fraction 0-1 lue en pourcentage, remise à zéro en date ISO (secondes unix)', () => {
    const msg = sdk({
      type: 'rate_limit_event',
      session_id: 's1',
      rate_limit_info: {
        status: 'allowed_warning',
        rateLimitType: 'five_hour',
        utilization: 0.42,
        resetsAt: 1_795_000_000,
      },
    });
    expect(traduireSdk(msg, nouvelEtatTraduction())).toEqual({
      evenements: [],
      claudeSessionId: 's1',
      limite: {
        genre: 'session',
        fenetre: { libelle: 'Session (5 h)', pourcent: 42, reinitialiseLe: new Date(1_795_000_000_000).toISOString() },
      },
    });
  });

  test('fenêtre semaine ; utilisation déjà en pourcentage (> 1) gardée telle quelle', () => {
    const msg = sdk({
      type: 'rate_limit_event',
      session_id: 's1',
      rate_limit_info: { status: 'allowed', rateLimitType: 'seven_day', utilization: 63 },
    });
    const sortie = traduireSdk(msg, nouvelEtatTraduction());
    expect(sortie.limite).toEqual({
      genre: 'semaine',
      fenetre: { libelle: 'Semaine', pourcent: 63, reinitialiseLe: null },
    });
  });

  test('autres plafonds (Opus, dépassement) ou valeur absente : aucune mise à jour', () => {
    const etat = nouvelEtatTraduction();
    for (const info of [
      { status: 'allowed', rateLimitType: 'seven_day_opus', utilization: 0.5 },
      { status: 'rejected', rateLimitType: 'five_hour' },
    ]) {
      expect(traduireSdk(sdk({ type: 'rate_limit_event', session_id: 's1', rate_limit_info: info }), etat)).toEqual({
        evenements: [],
        claudeSessionId: 's1',
      });
    }
  });
});

test('message de Chris rejoué par le SDK à sa prise (isReplay) : aucune bulle en plus de celle de l’envoi', () => {
  const etat = nouvelEtatTraduction();
  const rejeu = sdk({
    type: 'user',
    uuid: 'envoi-1',
    isReplay: true,
    session_id: 's1',
    parent_tool_use_id: null,
    message: { role: 'user', content: 'vas plus vite' },
  });
  expect(traduireSdk(rejeu, etat).evenements).toEqual([]);
});
