import { describe, expect, test } from 'bun:test';
import { cleDeCompte, retryApresMs } from './releve.ts';

describe('clé d’un compte', () => {
  test('le courriel, en minuscules, identifie le compte réel', () => {
    expect(cleDeCompte({ connecte: true, email: 'Chris@Example.com' })).toBe('courriel:chris@example.com');
  });

  test('sans courriel (jeton longue durée seul) ou déconnecté : pas de clé, donc pas de relevé', () => {
    expect(cleDeCompte({ connecte: true, email: null })).toBeNull();
    expect(cleDeCompte({ connecte: false, email: 'chris@example.com' })).toBeNull();
  });
});

describe('Retry-After', () => {
  test('secondes, date HTTP, absent ou illisible', () => {
    expect(retryApresMs('120')).toBe(120_000);
    expect(retryApresMs('Fri, 20 Nov 2026 10:05:00 GMT', Date.UTC(2026, 10, 20, 10, 0, 0))).toBe(300_000);
    expect(retryApresMs(null)).toBeNull();
    expect(retryApresMs('n’importe quoi')).toBeNull();
  });
});
