/**
 * Protège la panne #16 (E.4.3/G.1.4) : les trois catégories de messages d'usage ne
 * doivent jamais être confondues.
 */

import { describe, expect, test } from 'bun:test';
import { classifierMessageUsage, prefixesConnus } from './classification-usage.ts';

describe('classifierMessageUsage', () => {
  test('reconnaît chaque préfixe « limite atteinte » exporté par le SDK', () => {
    for (const prefixe of prefixesConnus().limite) {
      const classification = classifierMessageUsage(`${prefixe} — texte de suite quelconque`);
      expect(classification.categorie).toBe('limite_atteinte');
      expect(classification.prefixe).toBe(prefixe);
    }
  });

  test('reconnaît chaque préfixe « transition » exporté par le SDK', () => {
    for (const prefixe of prefixesConnus().transition) {
      const classification = classifierMessageUsage(`${prefixe} pour le reste de la fenêtre.`);
      expect(classification.categorie).toBe('transition');
      expect(classification.prefixe).toBe(prefixe);
    }
  });

  test('reconnaît chaque préfixe « avertissement » exporté par le SDK', () => {
    for (const prefixe of prefixesConnus().avertissement) {
      const classification = classifierMessageUsage(`${prefixe} 80% de votre allocation.`);
      expect(classification.categorie).toBe('avertissement');
      expect(classification.prefixe).toBe(prefixe);
    }
  });

  test('☠ un avertissement ne matche JAMAIS un préfixe de limite atteinte (panne #16)', () => {
    for (const prefixeAvertissement of prefixesConnus().avertissement) {
      const categorie = classifierMessageUsage(`${prefixeAvertissement} 90%`).categorie;
      expect(categorie).not.toBe('limite_atteinte');
    }
  });

  test('texte inconnu ⇒ catégorie « aucune », jamais une exception', () => {
    const classification = classifierMessageUsage('un statut quelconque sans rapport avec le quota');
    expect(classification).toEqual({ categorie: 'aucune', prefixe: null, texteBrut: classification.texteBrut });
  });

  test('chaîne vide ⇒ « aucune », pas de crash', () => {
    expect(classifierMessageUsage('').categorie).toBe('aucune');
  });
});
