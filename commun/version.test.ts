// Responsabilité : tests de la version du code et du commit (valeur compilée, fichier, absence).
import { describe, expect, test } from 'bun:test';
import { commitDe, VERSION } from './version.ts';

describe('commit du code', () => {
  test('la valeur compilée prime sur le fichier COMMIT', () => {
    expect(commitDe('abc1234', 'fff0000\n')).toBe('abc1234');
  });

  test('sans valeur compilée, le fichier COMMIT (espaces et saut de ligne retirés)', () => {
    expect(commitDe(undefined, 'fff0000\n')).toBe('fff0000');
  });

  test('ni compilé ni fichier : null, et une chaîne vide compte comme absente', () => {
    expect(commitDe(undefined, null)).toBeNull();
    expect(commitDe('  ', '\n')).toBeNull();
  });
});

describe('version', () => {
  test('la version du code est la même pour le poste, le relais et le moteur', () => {
    expect(VERSION).toBe('2.0.0');
  });
});
