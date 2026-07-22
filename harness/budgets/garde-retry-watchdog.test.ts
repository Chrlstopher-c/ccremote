/**
 * Protège l'acceptation (d) et la panne #15 : `CLAUDE_CODE_RETRY_WATCHDOG` jamais
 * activé sans budget actif.
 */

import { describe, expect, test } from 'bun:test';
import {
  GardeBudgetError,
  RETRY_WATCHDOG_ENV,
  assertRetryWatchdogCoherent,
  autoriserRetryWatchdog,
  budgetEstActif,
} from './garde-retry-watchdog.ts';

describe('budgetEstActif', () => {
  test('nombre fini strictement positif ⇒ actif', () => {
    expect(budgetEstActif(25)).toBe(true);
  });

  test('☠ Infinity ne borne rien : jamais traité comme un budget actif', () => {
    expect(budgetEstActif(Number.POSITIVE_INFINITY)).toBe(false);
  });

  test('zéro, négatif, null, undefined, NaN ⇒ inactif', () => {
    expect(budgetEstActif(0)).toBe(false);
    expect(budgetEstActif(-5)).toBe(false);
    expect(budgetEstActif(null)).toBe(false);
    expect(budgetEstActif(undefined)).toBe(false);
    expect(budgetEstActif(Number.NaN)).toBe(false);
  });
});

describe('autoriserRetryWatchdog', () => {
  test('budget actif ⇒ autorisé', () => {
    expect(autoriserRetryWatchdog(50).autorise).toBe(true);
  });

  test('sans budget actif ⇒ refusé', () => {
    expect(autoriserRetryWatchdog(undefined).autorise).toBe(false);
  });
});

describe('assertRetryWatchdogCoherent (panne #15)', () => {
  test("variable absente de l'environnement : jamais d'exception, peu importe le budget", () => {
    expect(() => assertRetryWatchdogCoherent({}, undefined)).not.toThrow();
  });

  test('variable posée à autre chose que "1" : ignoré (pas notre invariant à faire respecter)', () => {
    expect(() => assertRetryWatchdogCoherent({ [RETRY_WATCHDOG_ENV]: '0' }, undefined)).not.toThrow();
  });

  test('☠ "1" sans budget actif ⇒ lève GardeBudgetError', () => {
    expect(() => assertRetryWatchdogCoherent({ [RETRY_WATCHDOG_ENV]: '1' }, undefined)).toThrow(GardeBudgetError);
  });

  test('"1" avec budget actif ⇒ silencieux', () => {
    expect(() => assertRetryWatchdogCoherent({ [RETRY_WATCHDOG_ENV]: '1' }, 25)).not.toThrow();
  });

  test('☠ "1" avec Infinity comme « budget » ⇒ lève quand même (Infinity ne borne rien)', () => {
    expect(() => assertRetryWatchdogCoherent({ [RETRY_WATCHDOG_ENV]: '1' }, Number.POSITIVE_INFINITY)).toThrow(
      GardeBudgetError,
    );
  });
});
