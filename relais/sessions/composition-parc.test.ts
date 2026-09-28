import { describe, expect, test } from 'bun:test';
import type { FicheMachine } from '../registre/registre.ts';
import { parcPour, verifierOuverture } from './composition-parc.ts';

const fiche = (id: string): FicheMachine => ({
  id,
  description: `machine ${id}`,
  racines: [`/${id}`],
  projets: [],
  comptes: [],
  version: '2',
  etat: null,
  derniereVue: '',
});
const machines = ['pi', 'portable', 'tour', 'vps'].map(fiche);
const isolees = new Set(['vps']);

describe('composition du parc', () => {
  test('depuis la maison : tout le parc, VPS compris', () => {
    expect(parcPour('tour', machines, isolees).map((m) => m.id)).toEqual(['pi', 'portable', 'tour', 'vps']);
  });

  test('depuis le VPS : lui seul', () => {
    expect(parcPour('vps', machines, isolees).map((m) => m.id)).toEqual(['vps']);
  });

  test('le VPS ne peut pas ouvrir une session sur un projet de la maison', () => {
    expect(verifierOuverture('vps', { machine: 'tour', chemin: '/x', nom: 'x' }, isolees)).toContain('isolée');
    expect(verifierOuverture('vps', { machine: 'vps', chemin: '/x', nom: 'x' }, isolees)).toBeNull();
  });

  test('la maison peut travailler sur un projet du VPS', () => {
    expect(verifierOuverture('tour', { machine: 'vps', chemin: '/x', nom: 'x' }, isolees)).toBeNull();
  });
});
