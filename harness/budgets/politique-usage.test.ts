/**
 * Protège l'acceptation (c) et la panne #16 : suspendre/notifier/tracer ne doivent
 * jamais se confondre entre les trois catégories.
 */

import { describe, expect, test } from 'bun:test';
import { classifierMessageUsage } from './classification-usage.ts';
import { deciderActionUsage } from './politique-usage.ts';

describe('deciderActionUsage', () => {
  test("limite atteinte : suspend les créations ET notifie", () => {
    const decision = deciderActionUsage(classifierMessageUsage("You've hit your usage limit for this session."));
    expect(decision.suspendreCreations).toBe(true);
    expect(decision.notifier).toBe(true);
    expect(decision.tracer).toBe(true);
  });

  test('transition : notifie SANS suspendre', () => {
    const decision = deciderActionUsage(classifierMessageUsage("You're now using usage credits for this window."));
    expect(decision.suspendreCreations).toBe(false);
    expect(decision.notifier).toBe(true);
    expect(decision.tracer).toBe(true);
  });

  test("☠ avertissement : ne suspend RIEN et ne notifie RIEN (panne #16 — le cœur testable)", () => {
    const decision = deciderActionUsage(classifierMessageUsage("You've used 80% of your five-hour limit."));
    expect(decision.suspendreCreations).toBe(false);
    expect(decision.notifier).toBe(false);
    expect(decision.tracer).toBe(true);
  });

  test('texte hors sujet : aucun effet, pas même une trace', () => {
    const decision = deciderActionUsage(classifierMessageUsage('un message SDK quelconque'));
    expect(decision).toEqual({
      classification: decision.classification,
      suspendreCreations: false,
      notifier: false,
      tracer: false,
      motif: decision.motif,
    });
  });

  test("les trois catégories réelles produisent trois décisions strictement distinctes", () => {
    const limite = deciderActionUsage(classifierMessageUsage("You've reached your usage limit."));
    const transition = deciderActionUsage(classifierMessageUsage("Now using usage credits."));
    const avertissement = deciderActionUsage(classifierMessageUsage("You're close to your limit."));

    expect([limite.suspendreCreations, transition.suspendreCreations, avertissement.suspendreCreations]).toEqual([
      true,
      false,
      false,
    ]);
    expect([limite.notifier, transition.notifier, avertissement.notifier]).toEqual([true, true, false]);
  });
});
