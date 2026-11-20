import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pino from 'pino';
import { demarrerFauxApi, type FauxApi, trameFlux } from './faux-claude-ai.ts';
import { lireEvenement } from './donnees.ts';
import { FluxDistant, type TrameSse, lireTrames } from './flux-distant.ts';

const JETON = 'jeton-factice-flux-distant';
const SESSION = 'cse_flux_test';
const journal = pino({ enabled: false });
const FIXTURE = join(import.meta.dir, 'fixtures', 'flux-sse.txt');

let api: FauxApi;
let dossier: string;
const arrets: FluxDistant[] = [];

beforeEach(() => {
  api = demarrerFauxApi();
  process.env['CCREMOTE_API_CLAUDE_AI'] = api.url;
  dossier = mkdtempSync(join(tmpdir(), 'quart-flux-distant-'));
  mkdirSync(dossier, { recursive: true });
  writeFileSync(
    join(dossier, '.credentials.json'),
    JSON.stringify({ claudeAiOauth: { accessToken: JETON, expiresAt: Date.now() + 3_600_000 } }),
  );
});

afterEach(() => {
  for (const f of arrets.splice(0)) f.arreter();
  api.arreter();
  delete process.env['CCREMOTE_API_CLAUDE_AI'];
  rmSync(dossier, { recursive: true, force: true });
});

async function attendre(condition: () => boolean, delaiMs = 2_000): Promise<void> {
  const fin = Date.now() + delaiMs;
  while (!condition()) {
    if (Date.now() > fin) throw new Error('condition non remplie à temps');
    await Bun.sleep(5);
  }
}

function flux(
  depuis: number | null,
  surTrame: (t: TrameSse) => void,
  surRefus: (s: number) => void = () => undefined,
  extra = {},
): FluxDistant {
  const f = new FluxDistant({
    configDir: dossier,
    idSession: SESSION,
    journal,
    depuis,
    surTrame,
    surRefus,
    delaiBaseMs: 5,
    delaiMaxMs: 20,
    silenceMs: 10_000,
    ...extra,
  });
  arrets.push(f);
  return f;
}

const reprises = (): string[] => api.chemins.filter((c) => c.includes('/events/stream'));

describe('lecture des trames SSE', () => {
  test('trames complètes, commentaires et keepalive ignorés, reste gardé', () => {
    const { trames, reste } = lireTrames(
      ':keepalive\n\nevent: client_event\nid: 12\ndata: {"a":1}\n\nevent: session_update\ndata: {"b"\n',
    );
    expect(trames).toEqual([{ event: 'client_event', id: 12, data: '{"a":1}' }]);
    expect(reste).toBe('event: session_update\ndata: {"b"\n');
  });

  test('données sur plusieurs lignes réunies ; événement par défaut « message »', () => {
    const { trames } = lireTrames('data: un\ndata: deux\n\n');
    expect(trames).toEqual([{ event: 'message', id: null, data: 'un\ndeux' }]);
  });

  test('fixture capturée (anonymisée) : trames et événements du fil lisibles', () => {
    const { trames } = lireTrames(readFileSync(FIXTURE, 'utf8'));
    expect(trames.map((t) => t.event)).toEqual([
      'session_update',
      'catch_up_truncated',
      'client_event',
      'client_event',
      'client_event',
      'client_event',
      'client_event',
    ]);
    const evenements = trames.filter((t) => t.event === 'client_event').map((t) => lireEvenement(JSON.parse(t.data)));
    expect(evenements.every((e) => e !== null && e.seq !== null)).toBe(true);
    expect(evenements.map((e) => (e?.payload as { type?: string } | undefined)?.type)).toEqual([
      'system',
      'user',
      'assistant',
      'rate_limit_event',
      'result',
    ]);
  });
});

describe('flux d’une session', () => {
  test('les trames arrivent dans l’ordre ; la reprise après coupure part du dernier numéro reçu', async () => {
    const recues: TrameSse[] = [];
    api.scenariosFlux.set(SESSION, [
      { trames: [trameFlux('client_event', 5, { event_id: 'a' }), trameFlux('client_event', 6, { event_id: 'b' })] },
      { trames: [trameFlux('client_event', 7, { event_id: 'c' })], tenir: true },
    ]);
    const f = flux(null, (t) => recues.push(t));
    f.demarrer();
    await attendre(() => recues.length === 3);
    expect(recues.map((t) => t.id)).toEqual([5, 6, 7]);
    await attendre(() => reprises().length >= 2);
    expect(reprises()[1]).toContain('from_sequence_num=6');
  });

  test('sans numéro connu, la première connexion n’envoie pas de reprise', async () => {
    api.scenariosFlux.set(SESSION, [{ tenir: true }]);
    const f = flux(null, () => undefined);
    f.demarrer();
    await attendre(() => f.vivant);
    expect(reprises()).toHaveLength(1);
    expect(reprises()[0]).not.toContain('from_sequence_num');
  });

  test('un refus durable (404) arrête le flux sans reprise et le signale', async () => {
    const statuts: number[] = [];
    api.scenariosFlux.set(SESSION, [{ statut: 404 }]);
    const f = flux(
      null,
      () => undefined,
      (s) => statuts.push(s),
    );
    f.demarrer();
    await attendre(() => statuts.length === 1);
    await Bun.sleep(60);
    expect(statuts).toEqual([404]);
    expect(reprises()).toHaveLength(1);
    expect(f.vivant).toBe(false);
  });

  test('une erreur passagère (503) est reprise avec un délai, sans signalement', async () => {
    const statuts: number[] = [];
    api.scenariosFlux.set(SESSION, [{ statut: 503 }, { tenir: true }]);
    const f = flux(
      null,
      () => undefined,
      (s) => statuts.push(s),
    );
    f.demarrer();
    await attendre(() => reprises().length === 2 && f.vivant);
    expect(statuts).toEqual([]);
  });

  test('un flux qui se tait est coupé puis repris', async () => {
    api.scenariosFlux.set(SESSION, [{ tenir: true }, { tenir: true }]);
    const f = flux(
      null,
      () => undefined,
      () => undefined,
      { silenceMs: 40 },
    );
    f.demarrer();
    await attendre(() => reprises().length >= 2, 3_000);
  });

  test('arrêt : plus aucune connexion ensuite', async () => {
    api.scenariosFlux.set(SESSION, [{ tenir: true }]);
    const f = flux(null, () => undefined);
    f.demarrer();
    await attendre(() => reprises().length === 1);
    f.arreter();
    await Bun.sleep(80);
    expect(reprises()).toHaveLength(1);
    expect(f.vivant).toBe(false);
  });
});
