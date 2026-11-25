import { describe, expect, test } from 'bun:test';
import { champsSuivis } from './session-sdk-noyau.ts';

const CONTEXTE = { tokens: 100, max: 1_000_000 };

describe('fiche d’une session suivie hors d’ici', () => {
  test('dernière activité et contexte de la dernière fin de tour lue', () => {
    const evenements = [
      { ts: '2026-11-25T07:00:00Z', evt: { type: 'tour_fini', dureeMs: 1, contexte: 500 } },
      { ts: '2026-11-25T07:01:00Z', evt: { type: 'message', texte: 'x' } },
      { ts: '2026-11-25T07:02:00Z', evt: { type: 'tour_fini', dureeMs: 1, contexte: 700_704 } },
    ] as const;
    expect(champsSuivis(CONTEXTE, evenements)).toEqual({
      majLe: '2026-11-25T07:02:00Z',
      contexte: { tokens: 700_704, max: 1_000_000 },
    });
  });

  test('sans fin de tour : seule l’activité bouge', () => {
    const evenements = [{ ts: '2026-11-25T07:05:00Z', evt: { type: 'message', texte: 'x' } }] as const;
    expect(champsSuivis(CONTEXTE, evenements)).toEqual({ majLe: '2026-11-25T07:05:00Z' });
  });
});
