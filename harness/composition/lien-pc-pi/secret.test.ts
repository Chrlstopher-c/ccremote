import { describe, expect, test } from 'bun:test';
import { extraireSecret, secretValide, urlAvecSecret, urlSansSecret } from './secret.ts';

describe('secretValide', () => {
  test('accepte un secret identique', () => {
    expect(secretValide('le-vrai-secret', 'le-vrai-secret')).toBe(true);
  });

  test('refuse un secret différent, même de même longueur', () => {
    expect(secretValide('le-vrai-secrey', 'le-vrai-secret')).toBe(false);
  });

  test('refuse une longueur différente sans planter (timingSafeEqual exige des tailles égales)', () => {
    expect(secretValide('court', 'un-secret-bien-plus-long')).toBe(false);
  });

  test('refuse `null` (secret absent de la requête)', () => {
    expect(secretValide(null, 'le-vrai-secret')).toBe(false);
  });

  test('refuse une chaîne vide', () => {
    expect(secretValide('', 'le-vrai-secret')).toBe(false);
  });
});

describe('urlAvecSecret / extraireSecret / urlSansSecret', () => {
  test('round-trip : le secret ajouté est celui extrait côté Pi', () => {
    const url = urlAvecSecret('ws://pi.exemple:8721', 's3cr3t');
    const req = new Request(url.replace('ws://', 'http://'));
    expect(extraireSecret(req)).toBe('s3cr3t');
  });

  test('urlSansSecret ne porte jamais le secret — sûr à journaliser', () => {
    const url = urlAvecSecret('ws://pi.exemple:8721/lien', 's3cr3t-tres-sensible');
    const redigee = urlSansSecret(url);
    expect(redigee).not.toContain('s3cr3t-tres-sensible');
    expect(redigee).not.toContain('secret=');
  });
});
