// Responsabilité : tests du vocabulaire des groupes masqués de la barre latérale — forme validée, bornes,
// normalisation (une clé n'apparaît qu'une fois, la première gagne).
import { describe, expect, test } from 'bun:test';
import { GroupeMasque, ListeGroupesMasques, normaliserGroupesMasques } from './groupes-masques.ts';

const MAINTENANT = '2026-11-20T10:00:00.000Z';

function groupe(cle: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    cle,
    libelle: cle.toUpperCase(),
    genre: 'dossier',
    machine: 'tour',
    dossier: '/projets/app',
    masqueLe: MAINTENANT,
    ...extra,
  };
}

describe('forme d un groupe masqué', () => {
  test('un groupe dossier complet est accepté', () => {
    expect(GroupeMasque.safeParse(groupe('tour:/projets/app')).success).toBe(true);
  });

  test('un genre hors de dossier, machine, categorie est refusé', () => {
    expect(GroupeMasque.safeParse(groupe('x', { genre: 'session' })).success).toBe(false);
  });

  test('un libellé vide est refusé, un libellé de 200 caractères accepté', () => {
    expect(GroupeMasque.safeParse(groupe('x', { libelle: '' })).success).toBe(false);
    expect(GroupeMasque.safeParse(groupe('x', { libelle: 'a'.repeat(200) })).success).toBe(true);
    expect(GroupeMasque.safeParse(groupe('x', { libelle: 'a'.repeat(201) })).success).toBe(false);
  });

  test('une clé de plus de 600 caractères est refusée', () => {
    expect(GroupeMasque.safeParse(groupe('c'.repeat(600), { libelle: 'X' })).success).toBe(true);
    expect(GroupeMasque.safeParse(groupe('c'.repeat(601), { libelle: 'X' })).success).toBe(false);
    expect(GroupeMasque.safeParse(groupe('')).success).toBe(false);
  });

  test('machine et dossier peuvent être null (groupe de type machine ou catégorie)', () => {
    const r = GroupeMasque.safeParse(groupe('cat:1', { genre: 'categorie', machine: null, dossier: null }));
    expect(r.success).toBe(true);
  });
});

describe('liste de groupes masqués', () => {
  test('plus de 500 groupes : refusé ; 500 acceptés', () => {
    const cinq = Array.from({ length: 500 }, (_, i) => groupe(`c${i}`));
    expect(ListeGroupesMasques.safeParse(cinq).success).toBe(true);
    expect(ListeGroupesMasques.safeParse([...cinq, groupe('en-trop')]).success).toBe(false);
  });
});

describe('normalisation : une clé n apparaît qu une fois', () => {
  test('un doublon de clé est retiré, la première occurrence gagne, l ordre est conservé', () => {
    const premier = GroupeMasque.parse(groupe('a', { libelle: 'Premier' }));
    const second = GroupeMasque.parse(groupe('a', { libelle: 'Second' }));
    const autre = GroupeMasque.parse(groupe('b'));
    expect(normaliserGroupesMasques([premier, autre, second])).toEqual([premier, autre]);
  });

  test('une liste vide reste vide', () => {
    expect(normaliserGroupesMasques([])).toEqual([]);
  });
});
