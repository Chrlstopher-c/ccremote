import { describe, expect, test } from 'bun:test';
import { etatVide } from './etat.ts';
import { lierIdentifiant, ouvrirTache, reprendreTache } from './taches.ts';

describe('agent relancé par SendMessage', () => {
  test('sa durée repart de la relance', () => {
    const etat = etatVide();
    const t = ouvrirTache(etat, {
      id: 'u1', genre: 'agent', description: 'a', debutLe: '2026-11-23T00:00:00.000Z', prompt: null, modele: null,
    });
    lierIdentifiant(etat, t, 'a1');
    t.statut = 'terminee';
    reprendreTache(etat, 'a1', '2026-11-23T17:00:00.000Z');
    expect(t.debutLe).toBe('2026-11-23T17:00:00.000Z');
    expect(t.statut).toBe('en_cours');
  });
});
