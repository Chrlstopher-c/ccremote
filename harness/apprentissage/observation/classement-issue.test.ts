/**
 * Preuve E3 : un cas par valeur d'`IssueMission`, plus le cas capital —
 * `constatGit === null` ⇒ `inconnue`, jamais `livree` (PLAN-PORTAGE.md, E3).
 *
 * Conception inspirée de Hermes Agent (Nous Research) — MIT. Transposition indépendante en TypeScript.
 */

import { describe, expect, test } from 'bun:test';
import { classerIssue, type DonneesMissionTerminee } from './classement-issue.ts';

/** Mission « propre » par défaut : terminée, livrée, rien à signaler. Chaque test dévie d'un champ. */
function missionBase(overrides: Partial<DonneesMissionTerminee> = {}): DonneesMissionTerminee {
  return {
    etatHarness: 'terminee',
    derniereRaisonTerminale: null,
    constatGit: { fichiersModifies: 3, dernierCommit: 'abc123' },
    compteurRelances: 0,
    inspection: { verdict: null },
    budgetConsommeUsd: 5,
    budgetMaxUsd: 20,
    contexteTokensUtilises: 10_000,
    ...overrides,
  };
}

describe('classerIssue (E3)', () => {
  test('☠ constatGit === null ⇒ inconnue, JAMAIS livree — le piège capital', () => {
    const mission = missionBase({ constatGit: null, etatHarness: 'terminee' });
    expect(classerIssue(mission)).toBe('inconnue');
    expect(classerIssue(mission)).not.toBe('livree');
  });

  test('fichiers modifiés + commit ⇒ livree', () => {
    expect(classerIssue(missionBase())).toBe('livree');
  });

  test('fichiers modifiés sans commit ⇒ livree_partielle (travail non mis à l’abri)', () => {
    const mission = missionBase({ constatGit: { fichiersModifies: 7, dernierCommit: null } });
    expect(classerIssue(mission)).toBe('livree_partielle');
  });

  test('zéro fichier modifié ⇒ sans_effet', () => {
    const mission = missionBase({ constatGit: { fichiersModifies: 0, dernierCommit: null } });
    expect(classerIssue(mission)).toBe('sans_effet');
  });

  test('verdict d’inspection boucle ⇒ boucle', () => {
    const mission = missionBase({ inspection: { verdict: 'boucle' } });
    expect(classerIssue(mission)).toBe('boucle');
  });

  test('budget consommé ≥ budget max ⇒ budget_epuise', () => {
    const mission = missionBase({ budgetConsommeUsd: 20, budgetMaxUsd: 20 });
    expect(classerIssue(mission)).toBe('budget_epuise');
  });

  test('etatHarness annulee ⇒ interrompue', () => {
    const mission = missionBase({ etatHarness: 'annulee' });
    expect(classerIssue(mission)).toBe('interrompue');
  });

  test('etatHarness echec_definitif ⇒ echec_technique', () => {
    const mission = missionBase({ etatHarness: 'echec_definitif' });
    expect(classerIssue(mission)).toBe('echec_technique');
  });

  test('quatre relances ou plus ⇒ echec_technique (SPEC F-6, sans passer par echec_definitif)', () => {
    const mission = missionBase({ etatHarness: 'terminee', compteurRelances: 4 });
    expect(classerIssue(mission)).toBe('echec_technique');
  });

  test('priorité : constatGit === null bat tout le reste, même un verdict boucle', () => {
    const mission = missionBase({ constatGit: null, inspection: { verdict: 'boucle' }, etatHarness: 'annulee' });
    expect(classerIssue(mission)).toBe('inconnue');
  });
});
