// Adresses de l'aiguilleur : seules http(s) acceptées, le lien WebSocket est dérivé et son chemin imposé.
import { describe, expect, test } from 'bun:test';
import { urlAiguilleurValide } from './aiguilleur-http.ts';
import { urlLienAiguilleur } from './lien-aiguilleur.ts';

describe('adresses de l’aiguilleur', () => {
  test('http(s) seulement, réduit à l’origine', () => {
    expect(urlAiguilleurValide('https://aiguilleur.example.com/quelque/chose')).toBe('https://aiguilleur.example.com');
    expect(urlAiguilleurValide('ftp://example.com')).toBeNull();
    expect(urlAiguilleurValide('pas une adresse')).toBeNull();
  });

  test('le lien est ws/wss sur le chemin de l’aiguilleur', () => {
    expect(urlLienAiguilleur('http://127.0.0.1:9')).toBe('ws://127.0.0.1:9/aiguilleur');
    expect(urlLienAiguilleur('https://example.com')).toBe('wss://example.com/aiguilleur');
    expect(urlLienAiguilleur('ws://example.com')).toBeNull();
  });
});
