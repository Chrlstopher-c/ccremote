// Responsabilité : tests purs de l'échéance des tâches planifiées (P7) — unique, quotidienne (heure locale),
// intervalle,
// tâche inactive. Horloge fixée par le test : aucune attente réelle.
import { describe, expect, test } from 'bun:test';
import { type EcheanceTache, estDue, prochaineEcheance } from './echeance.ts';

const MAINTENANT = new Date(2026, 10, 20, 10, 0); // 20 nov. 2026, 10 h 00 locales
const base = { active: true, activeLe: null, derniere: null } satisfies Partial<EcheanceTache>;

describe('échéance des tâches planifiées', () => {
  test('tâche inactive : jamais due, pas de prochaine exécution', () => {
    const t: EcheanceTache = {
      ...base,
      active: false,
      frequence: { type: 'intervalle', minutes: 1 },
      activeLe: '2026-11-20T08:00:00.000Z',
    };
    expect(prochaineEcheance(t, MAINTENANT)).toBeNull();
    expect(estDue(t, MAINTENANT)).toBe(false);
  });

  test('unique : due une fois l’heure passée, jamais après une exécution', () => {
    const futur: EcheanceTache = { ...base, frequence: { type: 'unique', le: '2026-11-20T12:00:00.000Z' } };
    expect(estDue(futur, MAINTENANT)).toBe(false);
    const passe: EcheanceTache = { ...base, frequence: { type: 'unique', le: '2026-11-20T09:00:00.000Z' } };
    expect(estDue(passe, MAINTENANT)).toBe(true);
    const deja = { ...passe, derniere: { le: '2026-11-20T09:00:01.000Z' } };
    expect(prochaineEcheance(deja, MAINTENANT)).toBeNull();
  });

  test('quotidienne : l’heure locale du jour, pas de seconde exécution le même jour', () => {
    const t: EcheanceTache = {
      ...base,
      frequence: { type: 'quotidienne', heure: '09:00' },
      activeLe: new Date(2026, 10, 19, 8).toISOString(),
    };
    expect(estDue(t, new Date(2026, 10, 20, 8, 30))).toBe(false);
    expect(estDue(t, new Date(2026, 10, 20, 9, 30))).toBe(true);
    const lancee = { ...t, derniere: { le: new Date(2026, 10, 20, 9, 1).toISOString() } };
    expect(estDue(lancee, new Date(2026, 10, 20, 17, 0))).toBe(false);
    expect(prochaineEcheance(lancee, new Date(2026, 10, 20, 17, 0))).toEqual(new Date(2026, 10, 21, 9, 0));
  });

  test('quotidienne activée après l’heure du jour : attend le lendemain', () => {
    const t: EcheanceTache = {
      ...base,
      frequence: { type: 'quotidienne', heure: '09:00' },
      activeLe: new Date(2026, 10, 20, 9, 45).toISOString(),
    };
    expect(estDue(t, new Date(2026, 10, 20, 9, 50))).toBe(false);
    expect(prochaineEcheance(t, new Date(2026, 10, 20, 9, 50))).toEqual(new Date(2026, 10, 21, 9, 0));
  });

  test('intervalle : depuis l’activation, puis depuis la dernière exécution', () => {
    const t: EcheanceTache = {
      ...base,
      frequence: { type: 'intervalle', minutes: 30 },
      activeLe: new Date(2026, 10, 20, 10, 0).toISOString(),
    };
    expect(estDue(t, new Date(2026, 10, 20, 10, 20))).toBe(false);
    expect(estDue(t, new Date(2026, 10, 20, 10, 30))).toBe(true);
    const lancee = { ...t, derniere: { le: new Date(2026, 10, 20, 10, 30).toISOString() } };
    expect(prochaineEcheance(lancee, MAINTENANT)).toEqual(new Date(2026, 10, 20, 11, 0));
  });
});
