// Responsabilité : tests du choix de la source selon l'environnement et le jeton stocké (repli sur la démo).
/// <reference types="bun" />
import { describe, expect, test } from 'bun:test';
import { CLE_JETON, lireConfig, type StockageJeton } from './config';

function stockage(valeurs: Record<string, string>): StockageJeton {
  return { getItem: (cle) => valeurs[cle] ?? null };
}

const STOCKAGE_VIDE = stockage({});

describe('lireConfig', () => {
  test('sans VITE_SOURCE, la démo est la source par défaut', () => {
    expect(lireConfig({}, STOCKAGE_VIDE).source).toBe('demo');
  });

  test('relais complet : URL de l env et jeton du stockage local', () => {
    const config = lireConfig(
      { VITE_SOURCE: 'relais', VITE_RELAIS_URL: 'https://relais.example.com' },
      stockage({ [CLE_JETON]: 'jeton-stocke' }),
    );
    expect(config).toEqual({ source: 'relais', base: 'https://relais.example.com', jeton: 'jeton-stocke' });
  });

  test('relais sans jeton ou sans URL : repli sur la démo', () => {
    expect(lireConfig({ VITE_SOURCE: 'relais', VITE_RELAIS_URL: 'https://x.example.com' }, STOCKAGE_VIDE).source).toBe(
      'demo',
    );
    expect(lireConfig({ VITE_SOURCE: 'relais' }, stockage({ [CLE_JETON]: 'j' })).source).toBe('demo');
  });

  test('un stockage qui lève une exception (navigation privée) donne un repli, sans planter', () => {
    const casse: StockageJeton = {
      getItem: () => {
        throw new Error('accès refusé');
      },
    };
    expect(lireConfig({ VITE_SOURCE: 'relais', VITE_RELAIS_URL: 'https://x.example.com' }, casse).source).toBe('demo');
  });

  test('une valeur inconnue de VITE_SOURCE retombe sur la démo', () => {
    expect(lireConfig({ VITE_SOURCE: 'Relais' }, STOCKAGE_VIDE).source).toBe('demo');
  });
});
