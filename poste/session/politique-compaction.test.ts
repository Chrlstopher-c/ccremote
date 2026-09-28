import { describe, expect, test } from 'bun:test';
import { deciderCompaction, seuilsPour } from './politique-compaction.ts';

describe('politique de compaction', () => {
  test('fenêtre 1M : seuils plafonnés à 120k (étape) et 350k (dur)', () => {
    expect(seuilsPour(1_000_000)).toEqual({ etape: 120_000, dur: 350_000 });
  });

  test('fenêtre 200k : seuils proportionnels', () => {
    expect(seuilsPour(200_000)).toEqual({ etape: 80_000, dur: 140_000 });
  });

  test('fin d’étape sur un contexte léger : on ne compacte pas pour rien', () => {
    expect(deciderCompaction(60_000, 1_000_000, true)).toEqual({ agir: false });
  });

  test('fin d’étape sur un contexte lourd : compaction', () => {
    expect(deciderCompaction(150_000, 1_000_000, true)).toEqual({ agir: true, raison: 'etape' });
  });

  test('en cours d’étape, sous le seuil dur : on laisse travailler', () => {
    expect(deciderCompaction(300_000, 1_000_000, false)).toEqual({ agir: false });
  });

  test('au-delà du seuil dur : compaction même sans fin d’étape', () => {
    expect(deciderCompaction(360_000, 1_000_000, false)).toEqual({ agir: true, raison: 'seuil' });
  });
});
