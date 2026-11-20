import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pino from 'pino';
import { Evenement } from '../../commun/session.ts';
import type { EvenementHorodate } from '../session/historique.ts';
import { TraceRelais, fusionnerParDate } from './trace.ts';

// Trace des messages échangés entre sessions : persistée sur le poste, réinsérée à sa date dans l'historique.
const journal = pino({ enabled: false });
const SESSION = 'sess_A-1';
const AUTRE = { session: 'sess_B', titre: 'Cible', compte: 'principal' };

let dossier: string;
let trace: TraceRelais;

const texteDe = (h: EvenementHorodate): string =>
  h.evt.type === 'texte' ? h.evt.texte : h.evt.type === 'relais' ? 'relais' : h.evt.type;

function transcript(...lignes: [string, string][]): EvenementHorodate[] {
  return lignes.map(([ts, texte]) => ({ ts, evt: { type: 'texte', texte } }));
}

beforeEach(() => {
  dossier = mkdtempSync(join(tmpdir(), 'quart-trace-'));
  trace = new TraceRelais(dossier, journal);
});

afterEach(() => {
  rmSync(dossier, { recursive: true, force: true });
});

describe('trace persistée', () => {
  test('tracer écrit une ligne datée dans relais/<session>.jsonl et rend l’événement de fil', () => {
    const r = trace.tracer(SESSION, { sens: 'sortant', autre: AUTRE, texte: 'Bonjour' }, '2026-11-20T10:00:00.000Z');
    expect(r).toEqual({
      ts: '2026-11-20T10:00:00.000Z',
      evt: { type: 'relais', sens: 'sortant', ...AUTRE, texte: 'Bonjour' },
    });
    const ecrit = readFileSync(join(dossier, 'relais', `${SESSION}.jsonl`), 'utf8')
      .trim()
      .split('\n');
    expect(ecrit).toHaveLength(1);
    expect(Evenement.safeParse(JSON.parse(ecrit[0] ?? '{}').evt).success).toBe(true);
  });

  test('lire rend les traces dans l’ordre d’écriture ; une ligne illisible est ignorée', () => {
    trace.tracer(SESSION, { sens: 'entrant', autre: AUTRE, texte: 'Un' }, '2026-11-20T10:05:00.000Z');
    trace.tracer(SESSION, { sens: 'sortant', autre: AUTRE, texte: 'Deux' }, '2026-11-20T10:02:00.000Z');
    const fichier = join(dossier, 'relais', `${SESSION}.jsonl`);
    writeFileSync(fichier, `${readFileSync(fichier, 'utf8')}pas du json\n`);
    expect(trace.lire(SESSION).map((h) => (h.evt.type === 'relais' ? h.evt.texte : ''))).toEqual(['Un', 'Deux']);
  });

  test('une session sans trace : liste vide, aucun fichier créé', () => {
    expect(trace.lire('jamais')).toEqual([]);
  });

  test('un identifiant de session hors motif est refusé, rien n’est écrit', () => {
    const r = trace.tracer('../evil', { sens: 'sortant', autre: AUTRE, texte: 'x' }, '2026-11-20T10:00:00.000Z');
    expect(r).toBeNull();
    expect(trace.lire('../evil')).toEqual([]);
  });
});

describe('réinsertion dans l’historique', () => {
  test('les traces prennent leur place par date, entre les événements du transcript', () => {
    const t = transcript(
      ['2026-11-20T10:00:00.000Z', 'a'],
      ['2026-11-20T10:05:00.000Z', 'b'],
      ['2026-11-20T10:10:00.000Z', 'c'],
    );
    trace.tracer(SESSION, { sens: 'sortant', autre: AUTRE, texte: 'milieu' }, '2026-11-20T10:07:00.000Z');
    trace.tracer(SESSION, { sens: 'entrant', autre: AUTRE, texte: 'avant' }, '2026-11-20T09:59:00.000Z');
    const fusion = fusionnerParDate(t, trace.lire(SESSION));
    expect(fusion.map(texteDe)).toEqual(['relais', 'a', 'b', 'relais', 'c']);
    const textes = fusion.map((h) =>
      h.evt.type === 'relais' ? h.evt.texte : h.evt.type === 'texte' ? h.evt.texte : '',
    );
    expect(textes).toEqual(['avant', 'a', 'b', 'milieu', 'c']);
  });

  test('sans trace, l’historique est rendu tel quel', () => {
    const t = transcript(['2026-11-20T10:00:00.000Z', 'a']);
    expect(fusionnerParDate(t, [])).toEqual(t);
  });

  test('deux traces à la même date gardent leur ordre d’écriture', () => {
    trace.tracer(SESSION, { sens: 'sortant', autre: AUTRE, texte: 'premier' }, '2026-11-20T10:00:00.000Z');
    trace.tracer(SESSION, { sens: 'sortant', autre: AUTRE, texte: 'second' }, '2026-11-20T10:00:00.000Z');
    const fusion = fusionnerParDate([], trace.lire(SESSION));
    expect(fusion.map((h) => (h.evt.type === 'relais' ? h.evt.texte : ''))).toEqual(['premier', 'second']);
  });
});
