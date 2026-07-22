import { describe, expect, test } from 'bun:test';
import { definirBudget, repondrePermission } from './outils-arbitrage.ts';
import type { ArbitreEscalade, DefinisseurBudget } from './types.ts';

describe('repondrePermission (H-47 — voie d’escalade uniquement)', () => {
  test('verdict accepté par le bus ⇒ applique, tracé comme décision humaine par procuration', () => {
    const arbitre: ArbitreEscalade = { repondre: () => true };
    const resultat = repondrePermission(arbitre, 'r-1', { behavior: 'allow' });
    expect(resultat.effet).toBe('applique');
    expect(resultat.etat).toContain('décision humaine par procuration');
  });

  test('demande déjà tranchée ⇒ refus explicite, pas d’exception', () => {
    const arbitre: ArbitreEscalade = { repondre: () => false };
    const resultat = repondrePermission(arbitre, 'r-2', { behavior: 'deny', message: 'non' });
    expect(resultat.ok).toBe(false);
  });

  test('☠ (d) le port qui lève ne remonte jamais une exception au modèle', () => {
    const arbitre: ArbitreEscalade = {
      repondre: () => {
        throw new Error('bus hors service');
      },
    };
    expect(() => repondrePermission(arbitre, 'r-3', { behavior: 'allow' })).not.toThrow();
    const resultat = repondrePermission(arbitre, 'r-3', { behavior: 'allow' });
    expect(resultat.ok).toBe(false);
    expect(resultat.raison).toContain('bus hors service');
  });
});

describe('definirBudget (G, H-68 — filet, pas anti-boucle)', () => {
  test('montant invalide ⇒ refus sans toucher le port', async () => {
    let appele = false;
    const definisseur: DefinisseurBudget = {
      definir: async () => {
        appele = true;
      },
    };
    const resultat = await definirBudget(definisseur, 'm-1', -5);
    expect(resultat.ok).toBe(false);
    expect(appele).toBe(false);
  });

  test('succès ⇒ applique', async () => {
    const definisseur: DefinisseurBudget = { definir: async () => {} };
    const resultat = await definirBudget(definisseur, 'm-1', 150);
    expect(resultat.effet).toBe('applique');
  });

  test('☠ (a) port qui ne répond jamais ⇒ retour rapide en accepte, jamais un blocage', async () => {
    const definisseur: DefinisseurBudget = { definir: () => new Promise(() => {}) };
    const debut = Date.now();
    const resultat = await definirBudget(definisseur, 'm-1', 150, 30);
    expect(Date.now() - debut).toBeLessThan(500);
    expect(resultat.effet).toBe('accepte');
  });
});
