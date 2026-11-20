import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pino from 'pino';
import type { Evenement, ResumeSession } from '../../commun/session.ts';
import type { EvenementHorodate } from '../session/historique.ts';
import type { SortieSession } from '../session/session-poste.ts';
import { demarrerFauxApi, evenementApi, type FauxApi, sessionApi, tourApi } from './faux-claude-ai.ts';
import { type SessionBrute, lireSession } from './donnees.ts';
import { SessionDistante, PAS_ENCORE_CLAUDE_AI } from './session-distante.ts';
import { lireTrames } from './flux-distant.ts';
import { estMessageSdk, traduireLot } from './traduction-distante.ts';
import { nouvelEtatTraduction } from '../session/traduction-sdk.ts';

const JETON = 'jeton-factice-session-distante';
const journal = pino({ enabled: false });
const FIXTURE_FLUX = join(import.meta.dir, 'fixtures', 'flux-sse.txt');

let api: FauxApi;
let dossier: string;

function bruteDe(id: string, surcharge: Record<string, unknown> = {}): SessionBrute {
  const s = lireSession(sessionApi(id, surcharge));
  if (!s) throw new Error('session de test invalide');
  return s;
}

function sortieDeTest(): {
  sortie: SortieSession;
  evenements: Evenement[];
  historiques: EvenementHorodate[][];
} {
  const evenements: Evenement[] = [];
  const historiques: EvenementHorodate[][] = [];
  const sortie: SortieSession = {
    evenement: (_id: string, evt: Evenement) => void evenements.push(evt),
    historique: (_id: string, evts: readonly EvenementHorodate[]) => void historiques.push([...evts]),
    resume: (_r: ResumeSession) => undefined,
  };
  return { sortie, evenements, historiques };
}

function creer(brute: SessionBrute): {
  s: SessionDistante;
  evenements: Evenement[];
  historiques: EvenementHorodate[][];
} {
  const { sortie, evenements, historiques } = sortieDeTest();
  const contexte = { machine: 'tour', compte: 'principal', fenetreContexte: 1_000_000 };
  const s = new SessionDistante({ contexte, configDir: dossier, journal, sortie, publier: () => undefined }, brute);
  return { s, evenements, historiques };
}

const textes = (evts: readonly Evenement[]): string[] => evts.flatMap((e) => (e.type === 'texte' ? [e.texte] : []));

beforeEach(() => {
  api = demarrerFauxApi();
  process.env['CCREMOTE_API_CLAUDE_AI'] = api.url;
  dossier = mkdtempSync(join(tmpdir(), 'quart-session-distante-'));
  mkdirSync(dossier, { recursive: true });
  writeFileSync(
    join(dossier, '.credentials.json'),
    JSON.stringify({ claudeAiOauth: { accessToken: JETON, expiresAt: Date.now() + 3_600_000 } }),
  );
});

afterEach(() => {
  api.arreter();
  delete process.env['CCREMOTE_API_CLAUDE_AI'];
  rmSync(dossier, { recursive: true, force: true });
});

describe('historique d’une session claude.ai', () => {
  test('les événements sont émis en un lot, dans l’ordre d’origine, traduits du SDK', async () => {
    // Le fil est servi du plus récent au plus ancien, comme l'API.
    api.fils.set(
      'cse_h',
      [...[...tourApi(1, 'Premier'), ...tourApi(2, 'Deuxième'), ...tourApi(3, 'Troisième')]].reverse(),
    );
    const { s, evenements, historiques } = creer(bruteDe('cse_h'));
    const r = await s.charger();
    expect(r.ok).toBe(true);
    expect(historiques).toHaveLength(1);
    expect(textes(historiques[0]?.map((h) => h.evt) ?? [])).toEqual(['Premier', 'Deuxième', 'Troisième']);
    expect(evenements).toHaveLength(0);
    expect(s.vivante).toBe(true);
    expect(s.persistee.resume.id).toBe('cse_h');
    expect(s.resume.moteur).toBe('claude_ai');
  });

  test('un fil vide n’émet pas de lot', async () => {
    const { s, historiques } = creer(bruteDe('cse_vide'));
    expect(await s.charger()).toEqual({ ok: true, donnees: 0 });
    expect(historiques).toHaveLength(0);
  });

  test('un payload qui n’est pas un message du SDK est ignoré sans erreur', () => {
    const traduits = traduireLot(
      [
        { id: 'x', creeLe: 't', payload: { pas: 'un message' } },
        { id: 'y', creeLe: 't', payload: 'texte brut' },
      ],
      nouvelEtatTraduction(),
    );
    expect(traduits).toEqual([]);
    expect(estMessageSdk({ type: 'assistant' })).toBe(true);
    expect(estMessageSdk(null)).toBe(false);
  });
});

describe('suivi en direct d’une session claude.ai', () => {
  test('un nouvel événement est émis une seule fois', async () => {
    api.fils.set('cse_d', tourApi(1, 'Premier'));
    const { s, evenements } = creer(bruteDe('cse_d'));
    expect(await s.synchroniser(bruteDe('cse_d'))).toBeNull();

    api.fils.set('cse_d', [...tourApi(2, 'Deuxième'), ...tourApi(1, 'Premier')]);
    expect(await s.synchroniser(bruteDe('cse_d', { last_event_at: '2026-11-20T10:02:00.000Z' }))).toBeNull();
    expect(textes(evenements)).toEqual(['Deuxième']);

    expect(await s.synchroniser(bruteDe('cse_d', { last_event_at: '2026-11-20T10:02:00.000Z' }))).toBeNull();
    expect(textes(evenements)).toEqual(['Deuxième']);
  });

  test('pendant un tour (last_event_at figé), message de Chris, outils et texte arrivent en direct', async () => {
    api.fils.set('cse_t', tourApi(1, 'Premier'));
    const { s, evenements } = creer(bruteDe('cse_t'));
    await s.synchroniser(bruteDe('cse_t'));
    const enCours = bruteDe('cse_t', { worker_status: 'running' }); // last_event_at inchangé, comme claude.ai
    const t = '2026-11-20T10:05:00.000Z';
    const chris = { type: 'user', uuid: 'u2', origin: { kind: 'human' }, message: { role: 'user', content: 'Vas-y' } };
    const appel = {
      type: 'assistant',
      uuid: 'a2',
      parent_tool_use_id: null,
      message: { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: 'ls' } }] },
    };
    api.fils.set('cse_t', [evenementApi('ev-a2', appel, t), evenementApi('ev-u2', chris, t), ...tourApi(1, 'Premier')]);
    expect(await s.synchroniser(enCours)).toBeNull();
    expect(evenements.map((e) => e.type)).toEqual(['message', 'outil']);
    api.fils.set('cse_t', [...tourApi(2, 'Fini'), evenementApi('ev-a2', appel, t), evenementApi('ev-u2', chris, t), ...tourApi(1, 'Premier')]);
    // Le passage qui voit la fin du tour relit encore le fil, même si last_event_at n'avait pas bougé avant.
    expect(await s.synchroniser(bruteDe('cse_t', { worker_status: 'idle' }))).toBeNull();
    expect(textes(evenements)).toEqual(['Fini']);
  });

  test('une lecture échouée ne fait pas perdre le repère : le tour suivant reprend', async () => {
    api.fils.set('cse_e', tourApi(1, 'Premier'));
    const { s, evenements } = creer(bruteDe('cse_e'));
    await s.synchroniser(bruteDe('cse_e'));
    api.fils.set('cse_e', [...tourApi(2, 'Deuxième'), ...tourApi(1, 'Premier')]);
    const suivante = bruteDe('cse_e', { last_event_at: '2026-11-20T10:02:00.000Z' });
    api.statutForce = 500;
    expect(await s.synchroniser(suivante)).toBe('réponse HTTP 500 de claude.ai');
    api.statutForce = null;
    expect(await s.synchroniser(suivante)).toBeNull();
    expect(textes(evenements)).toEqual(['Deuxième']);
  });

  test('les outils de rythme et la compaction ne sont pas servis depuis claude.ai', async () => {
    const { s } = creer(bruteDe('cse_c'));
    expect(s.rythme()).toBe(PAS_ENCORE_CLAUDE_AI);
    expect(await s.compacter()).toBe(PAS_ENCORE_CLAUDE_AI);
  });

  test('la publication ne repart que sur changement ; une session rangée passe fermée', () => {
    const { s } = creer(bruteDe('cse_p'));
    expect(s.resumePourPublication()).not.toBeNull();
    expect(s.resumePourPublication()).toBeNull();
    s.passerFermee();
    expect(s.resumePourPublication()?.statut).toBe('fermee');
    expect(s.vivante).toBe(false);
  });
});

describe('mode de permission d’une session claude.ai', () => {
  test('le mode annoncé par un message system remplace le défaut', async () => {
    const init = {
      event_id: 'ev-mode', event_type: 'system', sequence_num: '99', created_at: '2026-11-20T10:05:00.000Z',
      source: 'worker', payload: { type: 'system', subtype: 'init', permissionMode: 'default' },
    };
    api.fils.set('cse_m', [init, ...tourApi(1, 'Premier')]);
    const { s } = creer(bruteDe('cse_m'));
    expect(await s.synchroniser(bruteDe('cse_m'))).toBeNull();
    expect(s.resume.mode).toBe('default');
  });
});

/** session_id porté par le payload d'un événement du fil (user, assistant, result), sinon null. */
function sessionDuPayload(evt: Record<string, unknown>): string | null {
  const p = evt['payload'];
  if (typeof p !== 'object' || p === null) return null;
  const sid = (p as Record<string, unknown>)['session_id'];
  return typeof sid === 'string' && sid !== '' ? sid : null;
}

describe('conversation Claude Code d’une session claude.ai', () => {
  test('le session_id du fil le plus récent devient la conversation du résumé (fixture SSE)', async () => {
    const trames = lireTrames(readFileSync(FIXTURE_FLUX, 'utf8')).trames;
    const evts = trames
      .filter((t) => t.event === 'client_event')
      .map((t): Record<string, unknown> => JSON.parse(t.data) as Record<string, unknown>);
    const chronologique = [...evts].sort((a, b) => Number(a['sequence_num']) - Number(b['sequence_num']));
    const attendu = chronologique.map(sessionDuPayload).filter((sid): sid is string => sid !== null).pop();
    expect(attendu).toBeDefined();
    api.fils.set('cse_conv_fixture', [...chronologique].reverse());
    const { s } = creer(bruteDe('cse_conv_fixture'));
    expect(await s.synchroniser(bruteDe('cse_conv_fixture'))).toBeNull();
    expect(s.resume.distant?.conversation).toBe(attendu);
  });

  test('un message plus récent d’une autre conversation remplace la précédente', async () => {
    const message = { role: 'assistant', content: [{ type: 'text', text: 'ok' }] };
    const ancien = evenementApi(
      'ev-conv-a',
      { type: 'assistant', session_id: 'conv-ancienne', message },
      '2026-11-20T10:01:00.000Z',
    );
    const recent = evenementApi(
      'ev-conv-b',
      { type: 'assistant', session_id: 'conv-recente', message },
      '2026-11-20T10:02:00.000Z',
    );
    api.fils.set('cse_conv_deux', [recent, ancien]);
    const { s } = creer(bruteDe('cse_conv_deux'));
    expect(await s.synchroniser(bruteDe('cse_conv_deux'))).toBeNull();
    expect(s.resume.distant?.conversation).toBe('conv-recente');
  });
});
