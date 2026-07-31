import { describe, expect, test } from 'bun:test';
import { annonceSaturation, fenetreEncoreSaturante } from './saturation-compte.ts';

describe('saturation d’un compte — formes RÉELLEMENT reçues du CLI', () => {
  test('☠ « weekly limit » — la forme vue en prod le 23/07, qu’AUCUN motif n’attrapait', () => {
    expect(annonceSaturation("You've hit your weekly limit · resets Jul 26, 9pm (Europe/Paris)")).toBe(true);
  });

  test('« monthly spend limit »', () => {
    expect(annonceSaturation("You've hit your monthly spend limit")).toBe(true);
  });

  test('« rate limit » et « quota exceeded » restent couverts', () => {
    expect(annonceSaturation('rate limit reached')).toBe(true);
    expect(annonceSaturation('quota exceeded for this organization')).toBe(true);
  });

  test('formulation française', () => {
    expect(annonceSaturation('Vous avez atteint votre limite de dépense')).toBe(true);
  });
});

describe('saturation — ce qui n’en est PAS une', () => {
  test('☠ un AVERTISSEMENT à 80 % n’écarte pas le compte (panne #16)', () => {
    expect(annonceSaturation("You've used 80% of your five-hour limit.")).toBe(false);
  });

  test('texte ordinaire mentionnant une limite sans l’atteindre', () => {
    expect(annonceSaturation('Je vais limiter la portée de cette analyse.')).toBe(false);
    expect(annonceSaturation('')).toBe(false);
  });
});

describe('une saturation ne survit pas à sa fenêtre', () => {
  const MAINTENANT = 1_700_000_000_000;

  test('☠ VÉCU 26→31/07 — reset PASSÉ : le verdict est caduc, le compte redevient disponible', () => {
    expect(fenetreEncoreSaturante({ statut: 'rejected', resetA: MAINTENANT - 1 }, MAINTENANT)).toBe(false);
  });

  test('reset à VENIR : la saturation tient', () => {
    expect(fenetreEncoreSaturante({ statut: 'rejected', resetA: MAINTENANT + 60_000 }, MAINTENANT)).toBe(true);
  });

  test('☠ fin de fenêtre INCONNUE : on ne relâche pas — inconnu ≠ expiré', () => {
    expect(fenetreEncoreSaturante({ statut: 'rejected', resetA: null }, MAINTENANT)).toBe(true);
  });

  test('un quota non rejeté n’écarte rien, reset passé ou non', () => {
    expect(fenetreEncoreSaturante({ statut: 'allowed', resetA: null }, MAINTENANT)).toBe(false);
    expect(fenetreEncoreSaturante({ statut: 'allowed_warning', resetA: MAINTENANT + 1 }, MAINTENANT)).toBe(false);
  });
});
