import { describe, expect, test } from 'bun:test';
import { chargerConfigAiguilleur } from '../config.ts';

const BASE = { LANTERNE_RELAIS_MODE: 'aiguilleur', LANTERNE_RELAIS_ECOUTE: '127.0.0.1:8080,127.0.0.2:8081' };

describe('configuration de l’aiguilleur', () => {
  test('écoute et données lues dans l’environnement ; base à part dans le dossier de données', () => {
    const c = chargerConfigAiguilleur({ ...BASE, LANTERNE_RELAIS_DONNEES: '/donnees/aiguilleur' });
    expect(c.ecouteWeb).toEqual([
      { hote: '127.0.0.1', port: 8080 },
      { hote: '127.0.0.2', port: 8081 },
    ]);
    expect(c.base).toBe('/donnees/aiguilleur/annuaire.db');
    expect(c.fichierEchecs).toBe('/donnees/aiguilleur/echecs-membres.json');
  });

  test('sans dossier de données ou sans écoute, la configuration est refusée au démarrage', () => {
    expect(() => chargerConfigAiguilleur({ ...BASE })).toThrow(/LANTERNE_RELAIS_DONNEES/);
    expect(() =>
      chargerConfigAiguilleur({ LANTERNE_RELAIS_MODE: 'aiguilleur', LANTERNE_RELAIS_DONNEES: '/d' }),
    ).toThrow(/LANTERNE_RELAIS_ECOUTE/);
  });
});
