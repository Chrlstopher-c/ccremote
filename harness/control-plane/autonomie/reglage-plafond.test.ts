/**
 * Le plafond d'autonomie est réglable — par fil, par défaut de parc, et jusqu'à
 * « illimité ». Ce qui est vérifié ici, ce n'est pas l'arithmétique : c'est que
 * les TROIS états restent distincts de bout en bout (« non réglé » n'est pas
 * « illimité »), et qu'un `null` voulu ne retombe jamais sur la valeur d'usine.
 */

import { describe, expect, test } from 'bun:test';
import {
  deciderAutorisation,
  ecrireReglagePlafond,
  ErreurPlafondInvalide,
  HERITE,
  lireReglagePlafond,
  lirePlafondAutonomieParc,
  normaliserReglagePlafond,
  plafondEffectif,
} from './index.ts';

describe('les trois états du réglage restent distincts', () => {
  test('un fil qui ne règle rien hérite du parc, un fil affranchi ne le fait pas', () => {
    expect(plafondEffectif(HERITE, 40)).toBe(40);
    expect(plafondEffectif({ type: 'valeur', max: 7 }, 40)).toBe(7);
    expect(plafondEffectif({ type: 'illimite' }, 40)).toBeNull();
    // Parc affranchi : un fil en héritage devient illimité par héritage.
    expect(plafondEffectif(HERITE, null)).toBeNull();
    // ☠ Et un fil qui a posé SA valeur reste borné même si le parc est ouvert.
    expect(plafondEffectif({ type: 'valeur', max: 3 }, null)).toBe(3);
  });

  test('aller-retour base : NULL en colonne signifie « hérite », jamais « illimité »', () => {
    expect(lireReglagePlafond(null)).toEqual(HERITE);
    expect(ecrireReglagePlafond(HERITE)).toBeNull();
    expect(lireReglagePlafond(ecrireReglagePlafond({ type: 'illimite' }))).toEqual({ type: 'illimite' });
    expect(lireReglagePlafond(ecrireReglagePlafond({ type: 'valeur', max: 12 }))).toEqual({
      type: 'valeur',
      max: 12,
    });
    // Une ligne illisible retombe sur l'héritage, elle ne fait pas lever une
    // lecture de fil — le comportement le plus conservateur.
    expect(lireReglagePlafond('n importe quoi')).toEqual(HERITE);
    expect(lireReglagePlafond('-4')).toEqual(HERITE);
  });
});

describe('ce qu’un modèle écrit est validé avant la moindre écriture', () => {
  test('les formes acceptées', () => {
    expect(normaliserReglagePlafond(null)).toEqual(HERITE);
    expect(normaliserReglagePlafond('')).toEqual(HERITE);
    expect(normaliserReglagePlafond(15)).toEqual({ type: 'valeur', max: 15 });
    expect(normaliserReglagePlafond('15')).toEqual({ type: 'valeur', max: 15 });
    // Les formes qu'un LLM écrit spontanément pour dire « pas de limite ».
    expect(normaliserReglagePlafond('illimite')).toEqual({ type: 'illimite' });
    expect(normaliserReglagePlafond('Illimité')).toEqual({ type: 'illimite' });
    expect(normaliserReglagePlafond(' aucun ')).toEqual({ type: 'illimite' });
  });

  test('☠ le refus PORTE les valeurs acceptées — un modèle se corrige sur une liste', () => {
    expect(() => normaliserReglagePlafond(0)).toThrow(ErreurPlafondInvalide);
    expect(() => normaliserReglagePlafond(-3)).toThrow(ErreurPlafondInvalide);
    expect(() => normaliserReglagePlafond('beaucoup')).toThrow(ErreurPlafondInvalide);
    expect(() => normaliserReglagePlafond('12 équipes')).toThrow(ErreurPlafondInvalide);
    try {
      normaliserReglagePlafond('beaucoup');
    } catch (erreur) {
      expect((erreur as Error).message).toContain('illimite');
      expect((erreur as Error).message).toContain('entier strictement positif');
    }
  });

  test('défaut de parc lu depuis l’environnement', () => {
    expect(lirePlafondAutonomieParc(undefined)).toBeUndefined();
    expect(lirePlafondAutonomieParc('')).toBeUndefined();
    expect(lirePlafondAutonomieParc('60')).toBe(60);
    expect(lirePlafondAutonomieParc('illimite')).toBeNull();
    expect(() => lirePlafondAutonomieParc('bof')).toThrow(ErreurPlafondInvalide);
  });
});

describe('la décision d’autorisation honore « illimité »', () => {
  const base = {
    approbationHumaineAnterieure: true,
    fenetreDebut: null,
    fenetreFin: null,
    maintenant: 1_000,
  };

  test('☠ plafond null ⇒ aucun mur, même très au-delà de la valeur d’usine', () => {
    const d = deciderAutorisation({ ...base, autoApprouveesDeja: 5_000, plafond: null });
    expect(d.mode).toBe('auto');
    expect(d.raison).toContain('∞');
    expect(d.raison).not.toContain("plafond d'autonomie atteint");
  });

  test('plafond réglé par le fil ⇒ le mur tombe à SA valeur, pas à 40', () => {
    expect(deciderAutorisation({ ...base, autoApprouveesDeja: 2, plafond: 3 }).mode).toBe('auto');
    const mur = deciderAutorisation({ ...base, autoApprouveesDeja: 3, plafond: 3 });
    expect(mur.mode).toBe('humain');
    expect(mur.raison).toContain('(3/3');
  });

  test('plafond absent ⇒ valeur d’usine, comportement historique intact', () => {
    expect(deciderAutorisation({ ...base, autoApprouveesDeja: 39 }).mode).toBe('auto');
    expect(deciderAutorisation({ ...base, autoApprouveesDeja: 40 }).mode).toBe('humain');
  });
});
