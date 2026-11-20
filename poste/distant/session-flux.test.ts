import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pino from 'pino';
import type { Evenement, ResumeSession } from '../../commun/session.ts';
import type { SortieSession } from '../session/session-poste.ts';
import { demarrerFauxApi, evenementApi, type FauxApi, sessionApi, tourApi, trameFlux } from './faux-claude-ai.ts';
import { type SessionBrute, lireSession } from './donnees.ts';
import { SessionDistante } from './session-distante.ts';

const JETON = 'jeton-factice-session-flux';
const SESSION = 'cse_session_flux';
const CREE_LE = '2026-11-20T10:30:00.000Z';
const journal = pino({ enabled: false });

let api: FauxApi;
let dossier: string;
let evenements: Evenement[];
const sessions: SessionDistante[] = [];

beforeEach(() => {
  api = demarrerFauxApi();
  process.env['CCREMOTE_API_CLAUDE_AI'] = api.url;
  dossier = mkdtempSync(join(tmpdir(), 'quart-session-flux-'));
  mkdirSync(dossier, { recursive: true });
  writeFileSync(
    join(dossier, '.credentials.json'),
    JSON.stringify({ claudeAiOauth: { accessToken: JETON, expiresAt: Date.now() + 3_600_000 } }),
  );
  evenements = [];
  api.fils.set(SESSION, [...tourApi(1, 'ancien')].reverse());
});

afterEach(() => {
  for (const s of sessions.splice(0)) s.arreterFlux();
  api.arreter();
  delete process.env['CCREMOTE_API_CLAUDE_AI'];
  rmSync(dossier, { recursive: true, force: true });
});

function brute(travail: string, surcharge: Record<string, unknown> = {}): SessionBrute {
  const s = lireSession(sessionApi(SESSION, { worker_status: travail, ...surcharge }));
  if (!s) throw new Error('session de test invalide');
  return s;
}

function nouvelle(): SessionDistante {
  const sortie: SortieSession = {
    evenement: (_id: string, evt: Evenement) => void evenements.push(evt),
    resume: (_r: ResumeSession) => undefined,
  };
  const contexte = { machine: 'tour', compte: 'principal', fenetreContexte: 1_000_000 };
  const s = new SessionDistante(
    { contexte, configDir: dossier, journal, sortie, publier: () => undefined },
    brute('running'),
  );
  sessions.push(s);
  return s;
}

const textes = (): string[] => evenements.flatMap((e) => (e.type === 'texte' ? [e.texte] : []));
const pagines = (): number => api.chemins.filter((c) => /\/events\?/.test(c)).length;

async function attendre(condition: () => boolean, delaiMs = 2_000): Promise<void> {
  const fin = Date.now() + delaiMs;
  while (!condition()) {
    if (Date.now() > fin) throw new Error('condition non remplie à temps');
    await Bun.sleep(5);
  }
}

const messageDirect = (id: string, texte: string): Record<string, unknown> =>
  evenementApi(
    id,
    {
      type: 'assistant',
      parent_tool_use_id: null,
      uuid: `u-${id}`,
      session_id: SESSION,
      message: { role: 'assistant', content: [{ type: 'text', text: texte }] },
    },
    CREE_LE,
  );

describe('fil d’une session pendant un tour', () => {
  test('le flux pousse le message en direct, une seule fois, sans relecture paginée pendant le tour', async () => {
    api.scenariosFlux.set(SESSION, [
      {
        trames: [
          trameFlux('client_event', 10, messageDirect('ev-direct', 'en direct')),
          trameFlux('client_event', 10, messageDirect('ev-direct', 'en direct')),
        ],
        tenir: true,
      },
    ]);
    const s = nouvelle();
    await s.synchroniser(brute('running'));
    await attendre(() => textes().includes('en direct'));
    await Bun.sleep(30);
    expect(textes().filter((t) => t === 'en direct')).toHaveLength(1);
    const avant = pagines();
    await s.synchroniser(brute('running'));
    expect(pagines()).toBe(avant);
  });

  test('la reprise du flux part du dernier numéro vu dans l’historique', async () => {
    api.scenariosFlux.set(SESSION, [{ tenir: true }]);
    const s = nouvelle();
    await s.synchroniser(brute('running'));
    await attendre(() => api.chemins.some((c) => c.includes('/events/stream')));
    expect(api.chemins.find((c) => c.includes('/events/stream'))).not.toContain('from_sequence_num');
  });

  test('flux refusé : le fil revient au sondage pendant le tour', async () => {
    api.scenariosFlux.set(SESSION, [{ statut: 404 }]);
    const s = nouvelle();
    await s.synchroniser(brute('running'));
    await Bun.sleep(40);
    const avant = pagines();
    await s.synchroniser(brute('running'));
    expect(pagines()).toBeGreaterThan(avant);
  });
});
