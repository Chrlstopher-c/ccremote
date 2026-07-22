import { describe, expect, test } from 'bun:test';
import { accepte, applique, differe, echecInattendu, refuse } from './contrat.ts';

describe('contrat de retour uniforme (A.2.3)', () => {
  test('applique : ok, sans ref/etat si non fournis', () => {
    expect(applique('lister')).toEqual({ ok: true, intention: 'lister', effet: 'applique' });
  });

  test('applique porte etat et ref quand fournis', () => {
    expect(applique('lister', 'trois équipes actives', 'lot-1')).toEqual({
      ok: true,
      intention: 'lister',
      effet: 'applique',
      etat: 'trois équipes actives',
      ref: 'lot-1',
    });
  });

  test("accepte est distinct d'applique — pris en compte, pas terminé", () => {
    const resultat = accepte('arrêter équipe', 'mission-1');
    expect(resultat.effet).toBe('accepte');
    expect(resultat.effet).not.toBe('applique');
    expect(resultat.ref).toBe('mission-1');
  });

  test('refuse porte toujours une raison', () => {
    const resultat = refuse('interrompre équipe', 'mission introuvable');
    expect(resultat.ok).toBe(false);
    expect(resultat.raison).toBe('mission introuvable');
  });

  test('differe porte ref et etat — H-61, rien n’est créé', () => {
    const resultat = differe('créer équipe', 'proposition-1', '{"mandat":"..."}');
    expect(resultat.effet).toBe('differe');
    expect(resultat.ok).toBe(true);
    expect(resultat.ref).toBe('proposition-1');
  });

  test('☠ echecInattendu ne relance jamais — toujours un refus exploitable', () => {
    const resultat = echecInattendu('définir budget', new Error('port hors service'));
    expect(resultat.ok).toBe(false);
    expect(resultat.effet).toBe('refuse');
    expect(resultat.raison).toContain('port hors service');
  });

  test('echecInattendu gère une valeur non-Error jetée', () => {
    const resultat = echecInattendu('définir budget', 'chaîne brute');
    expect(resultat.raison).toContain('chaîne brute');
  });
});
