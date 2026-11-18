// Responsabilité : tests de la branche active d'un transcript (rembobinage, duplication, compaction).
import { describe, expect, test } from 'bun:test';
import { brancheActive } from './branche.ts';
import type { Ligne } from './traduction.ts';

const l = (type: string, uuid: string, parentUuid: string | null, extra: Partial<Ligne> = {}): Ligne => ({
  type,
  uuid,
  parentUuid,
  ...extra,
});

describe('branche active du transcript', () => {
  test('la suite abandonnée par un rembobinage est retirée, le titre reste', () => {
    const lignes = [
      l('user', 'u1', null),
      l('assistant', 'a1', 'u1'),
      l('user', 'u2', 'a1'),
      l('assistant', 'a2', 'u2'),
      l('user', 'u3', 'a1'),
      l('assistant', 'a3', 'u3'),
      { type: 'custom-title', customTitle: 'Titre' },
    ];
    expect(brancheActive(lignes).map((x) => String(x.uuid ?? x.type))).toEqual([
      'u1',
      'a1',
      'u3',
      'a3',
      'custom-title',
    ]);
  });

  test('une compaction relie la suite par logicalParentUuid', () => {
    const lignes = [
      l('user', 'u1', null),
      l('assistant', 'a1', 'u1'),
      l('system', 's1', null, { logicalParentUuid: 'a1' }),
      l('user', 'u2', 's1'),
    ];
    expect(brancheActive(lignes)).toHaveLength(4);
  });

  test('sans uuid, rien n’est retiré', () => {
    const lignes: Ligne[] = [{ type: 'user' }, { type: 'assistant' }];
    expect(brancheActive(lignes)).toHaveLength(2);
  });
});
