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
    t.notifiee = true;
    reprendreTache(etat, 'a1', '2026-11-23T17:00:00.000Z');
    expect(t.debutLe).toBe('2026-11-23T17:00:00.000Z');
    expect(etat.taches.get('u1')?.statut).toBe('en_cours');
  });

  test('un message pendant qu’il travaille ne remet pas sa durée à zéro', () => {
    const etat = etatVide();
    const t = ouvrirTache(etat, {
      id: 'u2', genre: 'agent', description: 'b', debutLe: '2026-11-23T16:33:00.000Z', prompt: null, modele: null,
    });
    lierIdentifiant(etat, t, 'a2');
    reprendreTache(etat, 'a2', '2026-11-23T17:27:00.000Z');
    expect(t.debutLe).toBe('2026-11-23T16:33:00.000Z');
  });
});
