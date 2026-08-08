/**
 * Le domaine de la fenêtre d'autonomie : ce qu'un instant écrit par un modèle
 * devient, et ce qu'une plage a le droit d'être. Aucune I/O, aucun registre.
 */

import { describe, expect, test } from 'bun:test';
import {
  DUREE_FENETRE_MAX_MS,
  ErreurFenetreInvalide,
  ErreurInstantInvalide,
  natureFin,
  naturePlafond,
  normaliserInstant,
  validerFenetre,
} from './fenetre-autonomie.ts';

const MAINTENANT = Date.parse('2026-08-08T12:00:00Z');

describe('normaliserInstant', () => {
  test('« maintenant » et « now » rendent l’instant courant', () => {
    expect(normaliserInstant('maintenant', MAINTENANT)).toBe(MAINTENANT);
    expect(normaliserInstant('  NOW  ', MAINTENANT)).toBe(MAINTENANT);
  });

  test('décalages relatifs : minutes, heures, jours', () => {
    expect(normaliserInstant('+90min', MAINTENANT)).toBe(MAINTENANT + 90 * 60_000);
    expect(normaliserInstant('+8h', MAINTENANT)).toBe(MAINTENANT + 8 * 3_600_000);
    expect(normaliserInstant('+3j', MAINTENANT)).toBe(MAINTENANT + 3 * 86_400_000);
    expect(normaliserInstant('+ 2 d', MAINTENANT)).toBe(MAINTENANT + 2 * 86_400_000);
  });

  test('ISO 8601 avec fuseau explicite', () => {
    expect(normaliserInstant('2026-08-09T02:00:00Z', MAINTENANT)).toBe(Date.parse('2026-08-09T02:00:00Z'));
    expect(normaliserInstant('2026-08-09T04:00:00+02:00', MAINTENANT)).toBe(Date.parse('2026-08-09T02:00:00Z'));
  });

  test('epoch en millisecondes, en nombre comme en texte', () => {
    expect(normaliserInstant(MAINTENANT, MAINTENANT)).toBe(MAINTENANT);
    expect(normaliserInstant(String(MAINTENANT), MAINTENANT)).toBe(MAINTENANT);
  });

  // ☠ Le refus doit NOMMER les formes acceptées : l'appelant est un modèle, et
  // un refus nu le fait réémettre la même valeur au tour suivant.
  test('☠ une date sans heure est refusée, et le refus dit pourquoi et quoi écrire', () => {
    let message = '';
    try {
      normaliserInstant('2026-08-09', MAINTENANT);
    } catch (erreur) {
      message = erreur instanceof Error ? erreur.message : '';
    }
    expect(message).toContain('ambiguë');
    expect(message).toContain('+8h');
    expect(message).toContain('ISO 8601');
  });

  test('formes libres refusées', () => {
    expect(() => normaliserInstant('demain matin', MAINTENANT)).toThrow(ErreurInstantInvalide);
    expect(() => normaliserInstant('', MAINTENANT)).toThrow(ErreurInstantInvalide);
    expect(() => normaliserInstant('2026-13-45T02:00:00Z', MAINTENANT)).toThrow(ErreurInstantInvalide);
  });
});

describe('validerFenetre', () => {
  test('une plage normale passe et rend ses bornes', () => {
    const fin = MAINTENANT + 8 * 3_600_000;
    expect(validerFenetre(MAINTENANT, fin, MAINTENANT)).toEqual({ debut: MAINTENANT, fin });
  });

  test('☠ une fenêtre qui se termine avant de commencer est refusée', () => {
    expect(() => validerFenetre(MAINTENANT, MAINTENANT - 3_600_000, MAINTENANT)).toThrow(ErreurFenetreInvalide);
  });

  test('☠ une échéance déjà passée est refusée', () => {
    expect(() => validerFenetre(MAINTENANT - 7_200_000, MAINTENANT - 60_000, MAINTENANT)).toThrow(
      ErreurFenetreInvalide,
    );
  });

  // ☠ « trois mois » est le cas nommé : une année mal tapée ouvre une autonomie
  // qu'on ne remarque qu'après qu'elle a servi.
  test('☠ une plage de trois mois est refusée, et le refus donne le maximum', () => {
    let message = '';
    try {
      validerFenetre(MAINTENANT, MAINTENANT + 90 * 86_400_000, MAINTENANT);
    } catch (erreur) {
      message = erreur instanceof Error ? erreur.message : '';
    }
    expect(message).toContain('trop longue');
    expect(message).toContain('14 jours');
  });

  test('la borne haute est inclusive, un pas au-delà ne l’est pas', () => {
    expect(() => validerFenetre(MAINTENANT, MAINTENANT + DUREE_FENETRE_MAX_MS, MAINTENANT)).not.toThrow();
    expect(() => validerFenetre(MAINTENANT, MAINTENANT + DUREE_FENETRE_MAX_MS + 1, MAINTENANT)).toThrow(
      ErreurFenetreInvalide,
    );
  });

  test('une plage de moins de cinq minutes est refusée', () => {
    expect(() => validerFenetre(MAINTENANT, MAINTENANT + 60_000, MAINTENANT)).toThrow(ErreurFenetreInvalide);
  });
});

describe('natureFin — la garde porte sur la valeur', () => {
  test('sans fenêtre en cours, toute plage est une extension', () => {
    expect(natureFin(null, MAINTENANT + 3_600_000)).toBe('extension');
  });

  test('une fin plus proche resserre, une fin plus lointaine élargit', () => {
    const fin = MAINTENANT + 8 * 3_600_000;
    expect(natureFin(fin, fin - 60_000)).toBe('restriction');
    expect(natureFin(fin, fin)).toBe('inchange');
    expect(natureFin(fin, fin + 60_000)).toBe('extension');
  });
});

describe('naturePlafond — comparé à l’EFFECTIF, jamais au réglage brut', () => {
  test('baisser sous l’effectif est une restriction', () => {
    expect(naturePlafond(40, { type: 'valeur', max: 10 })).toBe('restriction');
  });

  test('☠ monter au-dessus de l’effectif est une extension, même depuis « herite »', () => {
    // Un fil en `herite` sous un parc à 40 : « 100 » n'est pas une baisse, même
    // si le fil n'a « rien » réglé. C'est le cas qui ferait passer une extension
    // pour un ajustement si on comparait au réglage brut du fil.
    expect(naturePlafond(40, { type: 'valeur', max: 100 })).toBe('extension');
    expect(naturePlafond(40, { type: 'illimite' })).toBe('extension');
  });

  test('depuis un fil illimité, toute valeur chiffrée resserre', () => {
    expect(naturePlafond(null, { type: 'valeur', max: 1000 })).toBe('restriction');
    expect(naturePlafond(null, { type: 'illimite' })).toBe('inchange');
  });

  test('« herite » ne dit rien de comparable : traité comme inchangé', () => {
    expect(naturePlafond(40, { type: 'herite' })).toBe('inchange');
  });
});
