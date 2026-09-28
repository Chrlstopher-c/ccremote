import { describe, expect, test } from 'bun:test';
import { lireUsage } from './usage.ts';

describe('usage OAuth', () => {
  test('liste `limits` (réponse réelle du 28/09, abrégée)', () => {
    const u = lireUsage({
      five_hour: { utilization: 14.0, resets_at: '2026-09-28T15:09:59Z' },
      limits: [
        { kind: 'session', percent: 14, resets_at: '2026-09-28T15:09:59Z' },
        { kind: 'weekly_all', percent: 12, resets_at: '2026-10-04T18:59:59Z' },
        {
          kind: 'weekly_scoped',
          percent: 0,
          resets_at: '2026-10-04T19:00:00Z',
          scope: { model: { display_name: 'Fable' } },
        },
      ],
    });
    expect(u.session?.pourcent).toBe(14);
    expect(u.semaine?.reinitialiseLe).toBe('2026-10-04T18:59:59Z');
    expect(u.autres).toEqual([{ libelle: 'Semaine · Fable', pourcent: 0, reinitialiseLe: '2026-10-04T19:00:00Z' }]);
  });

  test('repli sur five_hour / seven_day', () => {
    const u = lireUsage({ five_hour: { utilization: 40 }, seven_day: { utilization: 7, resets_at: null } });
    expect(u.session?.pourcent).toBe(40);
    expect(u.semaine?.pourcent).toBe(7);
  });

  test('réponse vide ou inattendue : aucune fenêtre, pas d’exception', () => {
    expect(lireUsage(null)).toEqual({ session: null, semaine: null, autres: [] });
    expect(lireUsage({ limits: 'x' })).toEqual({ session: null, semaine: null, autres: [] });
  });
});
