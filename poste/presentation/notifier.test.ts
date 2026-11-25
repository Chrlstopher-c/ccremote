import { describe, expect, test } from 'bun:test';
import pino from 'pino';
import type { ContexteOutils } from './outils.ts';
import { ECART_MIN_MS, notifier } from './notifier.ts';

function contexte(sessionId: string, recus: [string, string | null][]): ContexteOutils {
  return {
    sessionId,
    cwd: '/p',
    racines: [],
    stockage: {} as ContexteOutils['stockage'], // pas lu par l'outil
    emettre: () => undefined,
    journal: pino({ enabled: false }),
    notifier: (message, titre) => recus.push([message, titre]),
  };
}

describe('outil notifier', () => {
  test('pose la notification avec son titre facultatif', () => {
    const recus: [string, string | null][] = [];
    const r = notifier(contexte('a', recus), { message: ' Noctis se réinstalle dans 5 s ', titre: 'Mise à jour' }, 1_000);
    expect(r.erreur).toBe(false);
    expect(recus).toEqual([['Noctis se réinstalle dans 5 s', 'Mise à jour']]);
  });

  test('deux notifications trop rapprochées : la seconde est refusée', () => {
    const recus: [string, string | null][] = [];
    const c = contexte('b', recus);
    expect(notifier(c, { message: 'un' }, 1_000).erreur).toBe(false);
    expect(notifier(c, { message: 'deux' }, 1_000 + ECART_MIN_MS - 1).erreur).toBe(true);
    expect(notifier(c, { message: 'trois' }, 1_000 + ECART_MIN_MS).erreur).toBe(false);
    expect(recus.map(([m]) => m)).toEqual(['un', 'trois']);
  });

  test('session sans notifications : refus lisible', () => {
    const c = { ...contexte('c', []), notifier: undefined };
    expect(notifier(c, { message: 'x' }).texte).toContain('indisponibles');
  });
});
