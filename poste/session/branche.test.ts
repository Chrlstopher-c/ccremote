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

describe('branche active : compaction dont le message précédent manque', () => {
  test('la suite se rattache au message écrit juste avant la frontière', () => {
    const lignes = [
      l('user', 'u0', null),
      l('assistant', 'a0', 'u0'),
      l('system', 's1', null, { subtype: 'compact_boundary', logicalParentUuid: 'absent' }),
      l('user', 'u2', 's1'),
      l('assistant', 'a2', 'u2'),
    ];
    expect(brancheActive(lignes).map((x) => String(x.uuid))).toEqual(['u0', 'a0', 's1', 'u2', 'a2']);
  });

  test('une frontière dont le message précédent manque ne remonte pas au-delà de la compaction voisine', () => {
    const lignes = [
      l('user', 'u0', null),
      l('system', 's0', null, { subtype: 'compact_boundary', logicalParentUuid: 'u0' }),
      l('user', 'u1', 's0'),
      l('system', 's1', null, { subtype: 'compact_boundary', logicalParentUuid: 'absent' }),
      l('user', 'u2', 's1'),
    ];
    expect(brancheActive(lignes)).toHaveLength(5);
  });
});

describe('branche active : résumé de compaction sans parent', () => {
  // Défaut 3 (22/11) : le fil ne montrait plus que ce qui suit la compaction. Topologie reproduite : le résumé
  // n'a pas de parentUuid ; la chaîne s'arrêtait au résumé et tout l'historique d'avant disparaissait.
  test('le résumé sans parent se rattache à sa frontière : l’historique d’avant reste', () => {
    const lignes = [
      l('user', 'u0', null),
      l('assistant', 'a0', 'u0'),
      l('user', 'u1', 'a0'),
      l('assistant', 'a1', 'u1'),
      l('system', 's1', null, { subtype: 'compact_boundary', logicalParentUuid: 'a1' }),
      l('user', 'u3', null, { isCompactSummary: true }),
      l('user', 'u4', 'u3'),
      l('assistant', 'a4', 'u4'),
    ];
    expect(brancheActive(lignes).map((x) => String(x.uuid))).toEqual(['u0', 'a0', 'u1', 'a1', 's1', 'u3', 'u4', 'a4']);
  });
});

describe('branche active : réponse d’un appel de la branche écrite sur un embranchement', () => {
  test('la réponse à un appel actif reste, la suite abandonnée non', () => {
    const appel: Partial<Ligne> = { message: { content: [{ type: 'tool_use', id: 'T1' }] } };
    const reponse: Partial<Ligne> = { message: { content: [{ type: 'tool_result', tool_use_id: 'T1' }] } };
    const abandon: Partial<Ligne> = { message: { content: [{ type: 'tool_result', tool_use_id: 'T9' }] } };
    const lignes = [
      l('user', 'u0', null),
      l('assistant', 'a1', 'u0', appel),
      l('user', 'r1', 'a1', reponse),
      l('user', 'u2', 'a1'),
      l('user', 'r9', 'a1', abandon),
      l('assistant', 'a2', 'u2'),
    ];
    expect(brancheActive(lignes).map((x) => String(x.uuid))).toEqual(['u0', 'a1', 'r1', 'u2', 'a2']);
  });
});
