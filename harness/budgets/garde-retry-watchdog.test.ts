/**
 * Protège l'acceptation (d) et la panne #15 : `CLAUDE_CODE_RETRY_WATCHDOG` jamais
 * activé sans budget actif.
 */

import { describe, expect, test } from 'bun:test';
import {
  CompteurTentativesRetryWatchdog,
  GardeBudgetError,
  PLAFOND_TENTATIVES_RETRY_WATCHDOG_DEFAUT,
  RETRY_WATCHDOG_ENV,
  assertRetryWatchdogBorne,
  assertRetryWatchdogCoherent,
  autoriserRetryWatchdog,
  autoriserTentativeRetryWatchdog,
  budgetEstActif,
} from './garde-retry-watchdog.ts';
import { delaiBackoffMs } from '../relance/backoff.ts';

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

describe('CompteurTentativesRetryWatchdog / autoriserTentativeRetryWatchdog (C1)', () => {
  test('session inconnue : zéro tentative, plafond par défaut', () => {
    const compteur = new CompteurTentativesRetryWatchdog();
    const etat = compteur.etat('sess-1');
    expect(etat).toEqual({ sessionId: 'sess-1', tentativesEffectuees: 0, plafond: PLAFOND_TENTATIVES_RETRY_WATCHDOG_DEFAUT });
  });

  test('sous le plafond : autorisé, tentative enregistrée, backoff croissant', () => {
    const compteur = new CompteurTentativesRetryWatchdog(3);
    const d1 = autoriserTentativeRetryWatchdog('sess-1', compteur);
    expect(d1.autorise).toBe(true);
    expect(d1.delaiAvantProchaineMs).toBe(delaiBackoffMs(1));
    expect(compteur.etat('sess-1').tentativesEffectuees).toBe(1);

    const d2 = autoriserTentativeRetryWatchdog('sess-1', compteur);
    expect(d2.autorise).toBe(true);
    expect(d2.delaiAvantProchaineMs).toBe(delaiBackoffMs(2));
    expect(compteur.etat('sess-1').tentativesEffectuees).toBe(2);
  });

  test('☠ plafond atteint : refusé, PAS de relance infinie, aucune tentative de plus enregistrée', () => {
    const compteur = new CompteurTentativesRetryWatchdog(2);
    autoriserTentativeRetryWatchdog('sess-1', compteur);
    autoriserTentativeRetryWatchdog('sess-1', compteur);
    const refus = autoriserTentativeRetryWatchdog('sess-1', compteur);
    expect(refus.autorise).toBe(false);
    expect(refus.motif).toContain('plafond');
    // Le refus ne compte pas comme une tentative de plus : le compteur reste figé au plafond.
    expect(compteur.etat('sess-1').tentativesEffectuees).toBe(2);
    // Un appel supplémentaire redonne le même refus, à l'identique — jamais de boucle qui repart.
    expect(autoriserTentativeRetryWatchdog('sess-1', compteur).autorise).toBe(false);
  });

  test('deux sessions différentes ne partagent jamais leur compteur (H-11)', () => {
    const compteur = new CompteurTentativesRetryWatchdog(1);
    autoriserTentativeRetryWatchdog('sess-a', compteur);
    const refusA = autoriserTentativeRetryWatchdog('sess-a', compteur);
    const decisionB = autoriserTentativeRetryWatchdog('sess-b', compteur);
    expect(refusA.autorise).toBe(false);
    expect(decisionB.autorise).toBe(true);
  });

  test('reinitialiser efface la session, un nouveau réarmement repart de zéro', () => {
    const compteur = new CompteurTentativesRetryWatchdog(1);
    autoriserTentativeRetryWatchdog('sess-1', compteur);
    compteur.reinitialiser('sess-1');
    expect(autoriserTentativeRetryWatchdog('sess-1', compteur).autorise).toBe(true);
  });
});

describe('assertRetryWatchdogBorne (C1 + H-68 combinés)', () => {
  test('budget inactif ⇒ refuse pour la même raison que assertRetryWatchdogCoherent, sans consommer de tentative', () => {
    const compteur = new CompteurTentativesRetryWatchdog(5);
    expect(() => assertRetryWatchdogBorne({ [RETRY_WATCHDOG_ENV]: '1' }, undefined, 'sess-1', compteur)).toThrow(
      GardeBudgetError,
    );
    expect(compteur.etat('sess-1').tentativesEffectuees).toBe(0);
  });

  test('budget actif, sous le plafond ⇒ silencieux, une tentative enregistrée', () => {
    const compteur = new CompteurTentativesRetryWatchdog(5);
    expect(() => assertRetryWatchdogBorne({ [RETRY_WATCHDOG_ENV]: '1' }, 25, 'sess-1', compteur)).not.toThrow();
    expect(compteur.etat('sess-1').tentativesEffectuees).toBe(1);
  });

  test('☠ budget actif MAIS plafond de tentatives atteint ⇒ lève quand même (pas de relance infinie)', () => {
    const compteur = new CompteurTentativesRetryWatchdog(2);
    assertRetryWatchdogBorne({ [RETRY_WATCHDOG_ENV]: '1' }, 25, 'sess-1', compteur);
    assertRetryWatchdogBorne({ [RETRY_WATCHDOG_ENV]: '1' }, 25, 'sess-1', compteur);
    expect(() => assertRetryWatchdogBorne({ [RETRY_WATCHDOG_ENV]: '1' }, 25, 'sess-1', compteur)).toThrow(GardeBudgetError);
  });

  test('variable absente ⇒ jamais d’exception et aucune tentative consommée, quel que soit le plafond', () => {
    const compteur = new CompteurTentativesRetryWatchdog(0);
    expect(() => assertRetryWatchdogBorne({}, 25, 'sess-1', compteur)).not.toThrow();
    expect(compteur.etat('sess-1').tentativesEffectuees).toBe(0);
  });
});
