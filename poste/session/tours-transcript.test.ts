// Responsabilité : tests des tours d'une session lue dans son transcript (hors Lanterne) — même nombre de tours
// et mêmes jetons à la relecture complète qu'au suivi incrémental, sous-agents et erreurs d'API exclus.
import { describe, expect, test } from 'bun:test';
import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pino from 'pino';
import type { Evenement } from '../../commun/session.ts';
import { evenementsDuTranscript, type EvenementHorodate } from './historique.ts';
import { LectureIncrementale } from './lecture-incrementale.ts';

const FIXTURE = join(import.meta.dir, 'fixtures', 'tours-transcript.jsonl');
const LIGNES = readFileSync(FIXTURE, 'utf8').split('\n').filter((l) => l.trim() !== '');
// Coupures : la première tombe au milieu des lignes d'un même message (msg-01) : son usage ne doit compter
// qu'une fois ; la seconde est avant le tour suivant.
const COUPURE_1 = 2;
const COUPURE_2 = 9;

function tours(evenements: readonly EvenementHorodate[]): EvenementHorodate[] {
  return evenements.filter((e) => e.evt.type === 'tour_fini');
}

const ATTENDUS: Evenement[] = [
  { type: 'tour_fini', dureeMs: 4000, contexte: 162, entree: 277, sortie: 50, uuid: 'a3' },
  { type: 'tour_fini', dureeMs: 6000, contexte: 230, entree: 230, sortie: 40, uuid: 'a4' },
];

describe('tours d’une session relue dans son transcript', () => {
  test('relecture complète : un tour par réponse, jetons comptés une fois par message', () => {
    const relus = tours(evenementsDuTranscript(LIGNES.join('\n')));
    expect(relus.map((e) => e.evt)).toEqual(ATTENDUS);
    expect(relus.map((e) => e.ts)).toEqual(['2026-11-01T10:00:04.000Z', '2026-11-01T10:00:09.000Z']);
  });

  test('fin de tour sans réponse de Claude : pas un tour', () => {
    const isolee =
      '{"type":"system","subtype":"turn_duration","durationMs":100,"uuid":"x1","parentUuid":null,' +
      '"isSidechain":false,"timestamp":"2026-11-01T10:00:00.000Z"}';
    expect(tours(evenementsDuTranscript(isolee))).toEqual([]);
  });

  test('suivi incrémental : mêmes tours, mêmes horodatages que la relecture complète', () => {
    const dossier = mkdtempSync(join(tmpdir(), 'quart-tours-'));
    const chemin = join(dossier, 'session.jsonl');
    try {
      writeFileSync(chemin, `${LIGNES.slice(0, COUPURE_1).join('\n')}\n`);
      const lecture = new LectureIncrementale(chemin, pino({ enabled: false }));
      const vus: EvenementHorodate[] = [...lecture.relireTout()];
      appendFileSync(chemin, `${LIGNES.slice(COUPURE_1, COUPURE_2).join('\n')}\n`);
      vus.push(...(lecture.ajout() ?? []));
      appendFileSync(chemin, `${LIGNES.slice(COUPURE_2).join('\n')}\n`);
      vus.push(...(lecture.ajout() ?? []));
      expect(tours(vus)).toEqual(tours(evenementsDuTranscript(LIGNES.join('\n'))));
      expect(tours(vus).map((e) => e.evt)).toEqual(ATTENDUS);
    } finally {
      rmSync(dossier, { recursive: true, force: true });
    }
  });
});
