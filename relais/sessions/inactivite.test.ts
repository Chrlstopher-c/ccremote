import { describe, expect, test } from 'bun:test';
import { inactiveDepuis, SEUIL_INACTIVITE_MS } from './inactivite.ts';

const MAJ = '2026-11-15T10:00:00.000Z';
const a = (minutes: number): Date => new Date(Date.parse(MAJ) + minutes * 60_000);

describe('inactivité d une session', () => {
  test('seuil par défaut : 30 minutes', () => {
    expect(SEUIL_INACTIVITE_MS).toBe(30 * 60_000);
  });

  test('tour fini (attente ou terminée) depuis plus de 30 min : inactive depuis la dernière activité', () => {
    expect(inactiveDepuis('attente', MAJ, a(30), SEUIL_INACTIVITE_MS)).toBe(MAJ);
    expect(inactiveDepuis('terminee', MAJ, a(120), SEUIL_INACTIVITE_MS)).toBe(MAJ);
  });

  test('pas encore au seuil : null', () => {
    expect(inactiveDepuis('attente', MAJ, a(29), SEUIL_INACTIVITE_MS)).toBeNull();
  });

  test('jamais pendant un travail, une compaction, une question ou un démarrage', () => {
    for (const statut of ['travail', 'compaction', 'question', 'demarrage'] as const) {
      expect(inactiveDepuis(statut, MAJ, a(600), SEUIL_INACTIVITE_MS)).toBeNull();
    }
  });

  test('erreur et fermée ne sont pas des tours finis : null', () => {
    expect(inactiveDepuis('erreur', MAJ, a(600), SEUIL_INACTIVITE_MS)).toBeNull();
    expect(inactiveDepuis('fermee', MAJ, a(600), SEUIL_INACTIVITE_MS)).toBeNull();
  });

  test('retour à null dès qu une activité repousse majLe', () => {
    const nouvelle = a(600).toISOString();
    expect(inactiveDepuis('attente', nouvelle, a(601), SEUIL_INACTIVITE_MS)).toBeNull();
  });

  test('date illisible : null, sans lever d erreur', () => {
    expect(inactiveDepuis('attente', 'pas-une-date', a(600), SEUIL_INACTIVITE_MS)).toBeNull();
  });
});
