import { describe, expect, test } from 'bun:test';
import { entetesAuth, extraireSecret, secretValide, urlSansSecret } from './secret.ts';

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

describe('entetesAuth / extraireSecret', () => {
  test('round-trip : le secret posé en en-tête est celui extrait côté Pi', () => {
    const req = new Request('http://pi.exemple:8721/', { headers: entetesAuth('s3cr3t') });
    expect(extraireSecret(req)).toBe('s3cr3t');
  });

  test('☠ le secret ne transite JAMAIS par l’URL — sinon il finit dans les access logs de Cloudflare', () => {
    const entetes = entetesAuth('s3cr3t-tres-sensible');
    const req = new Request('http://pi.exemple:8721/lien', { headers: entetes });
    expect(req.url).not.toContain('s3cr3t-tres-sensible');
    expect(req.url).not.toContain('secret=');
    expect(extraireSecret(req)).toBe('s3cr3t-tres-sensible');
  });

  test('en-tête absent ou sans le schéma Bearer ⇒ null, jamais une valeur partielle', () => {
    expect(extraireSecret(new Request('http://pi.exemple:8721/'))).toBeNull();
    expect(extraireSecret(new Request('http://pi.exemple:8721/', { headers: { authorization: 's3cr3t' } }))).toBeNull();
  });
});

describe('urlSansSecret', () => {
  test('retire tout paramètre de requête — filet si quelqu’un en rajoute un plus tard', () => {
    expect(urlSansSecret('ws://pi.exemple:8721/lien?jeton=abc')).toBe('ws://pi.exemple:8721/lien');
  });
});
