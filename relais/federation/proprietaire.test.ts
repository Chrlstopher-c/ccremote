// Règle « de mes machines » et état des voisins vus dans la présence de l'aiguilleur.
// Fonctions pures : données fictives.
import { describe, expect, test } from 'bun:test';
import {
  estDeMesMachines,
  RAISON_PAS_A_TOI,
  RAISON_PROPRIETAIRE_INCONNU,
  raisonRefus,
  Voisinage,
} from './proprietaire.ts';

describe('estDeMesMachines', () => {
  test('un nœud du même propriétaire que nous est des nôtres', () => {
    expect(estDeMesMachines({ genre: 'noeud', proprietaire: 'chris' }, 'chris')).toBe(true);
  });

  test('un nœud d’un autre propriétaire, ou un appareil, n’en est pas', () => {
    expect(estDeMesMachines({ genre: 'noeud', proprietaire: 'matheo' }, 'chris')).toBe(false);
    expect(estDeMesMachines({ genre: 'appareil', proprietaire: 'chris' }, 'chris')).toBe(false);
  });

  test('propriétaire inconnu, de l’un ou de l’autre côté : jamais des nôtres', () => {
    expect(estDeMesMachines({ genre: 'noeud', proprietaire: null }, 'chris')).toBe(false);
    expect(estDeMesMachines({ genre: 'noeud', proprietaire: 'chris' }, null)).toBe(false);
    expect(estDeMesMachines({ genre: null, proprietaire: 'chris' }, 'chris')).toBe(false);
  });
});

describe('raisonRefus', () => {
  test('aucun refus pour un nœud à nous', () => {
    const tour = { id: 'a', enLigne: true, nom: 'tour', genre: 'noeud' as const, proprietaire: 'chris' };
    expect(raisonRefus(tour, 'chris')).toBeNull();
  });

  test('membre absent de la présence, ou propriétaire inconnu : refusé comme inconnu', () => {
    expect(raisonRefus(undefined, 'chris')).toBe(RAISON_PROPRIETAIRE_INCONNU);
    expect(raisonRefus({ id: 'a', enLigne: true, nom: '', genre: 'noeud', proprietaire: null }, 'chris')).toBe(
      RAISON_PROPRIETAIRE_INCONNU,
    );
    expect(raisonRefus({ id: 'a', enLigne: true, nom: '', genre: null, proprietaire: 'chris' }, 'chris')).toBe(
      RAISON_PROPRIETAIRE_INCONNU,
    );
    expect(raisonRefus({ id: 'a', enLigne: true, nom: 'tour', genre: 'noeud', proprietaire: 'chris' }, null)).toBe(
      RAISON_PROPRIETAIRE_INCONNU,
    );
  });

  test('un nœud d’un autre propriétaire, ou un appareil du nôtre : « pas à toi »', () => {
    expect(raisonRefus({ id: 'a', enLigne: true, nom: 'x', genre: 'noeud', proprietaire: 'matheo' }, 'chris')).toBe(
      RAISON_PAS_A_TOI,
    );
    expect(raisonRefus({ id: 'a', enLigne: true, nom: 'x', genre: 'appareil', proprietaire: 'chris' }, 'chris')).toBe(
      RAISON_PAS_A_TOI,
    );
  });
});

describe('Voisinage', () => {
  test('la présence donne nom, genre, propriétaire et état, et marque les nôtres', () => {
    const v = new Voisinage();
    v.remplacer([
      { id: 'a', enLigne: true, nom: 'tour', genre: 'noeud', proprietaire: 'chris' },
      { id: 'b', enLigne: false, nom: 'iphone', genre: 'appareil', proprietaire: 'chris' },
      { id: 'c', enLigne: true, nom: 'pi', genre: 'noeud', proprietaire: 'matheo' },
    ]);
    expect(v.liste('chris')).toEqual([
      { id: 'a', enLigne: true, nom: 'tour', genre: 'noeud', proprietaire: 'chris', mien: true },
      { id: 'b', enLigne: false, nom: 'iphone', genre: 'appareil', proprietaire: 'chris', mien: false },
      { id: 'c', enLigne: true, nom: 'pi', genre: 'noeud', proprietaire: 'matheo', mien: false },
    ]);
    expect(v.enLigne('b')).toBe(false);
    expect(v.joignable('a', 'chris')).toBe(true);
    expect(v.joignable('c', 'chris')).toBe(false);
    expect(v.joignable('b', 'chris')).toBe(false);
  });

  test('un aiguilleur ancien, sans nom ni genre ni propriétaire, donne des valeurs neutres', () => {
    const v = new Voisinage();
    v.remplacer([{ id: 'a', enLigne: true }]);
    expect(v.liste('chris')).toEqual([
      { id: 'a', enLigne: true, nom: '', genre: null, proprietaire: null, mien: false },
    ]);
    expect(v.refusPour('a', 'chris')).toBe(RAISON_PROPRIETAIRE_INCONNU);
  });

  test('un ouvrir nomme le propriétaire de l’ouvrant ; le genre ne vient que de la présence', () => {
    const v = new Voisinage();
    v.memoriserOuvrant('a', 'chris');
    expect(v.enLigne('a')).toBe(true);
    expect(v.refusPour('a', 'chris')).toBe(RAISON_PROPRIETAIRE_INCONNU);
    v.remplacer([{ id: 'a', enLigne: true, nom: 'tour', genre: 'noeud', proprietaire: 'chris' }]);
    expect(v.refusPour('a', 'chris')).toBeNull();
    expect(v.liste('chris')[0]).toMatchObject({ nom: 'tour', genre: 'noeud', mien: true });
  });

  test('une nouvelle présence remplace l’ancienne ; effacer vide tout', () => {
    const v = new Voisinage();
    v.remplacer([{ id: 'a', enLigne: true, nom: 'tour', genre: 'noeud', proprietaire: 'chris' }]);
    v.remplacer([]);
    expect(v.liste('chris')).toEqual([]);
    v.remplacer([{ id: 'a', enLigne: true, nom: 'tour', genre: 'noeud', proprietaire: 'chris' }]);
    v.effacer();
    expect(v.enLigne('a')).toBe(false);
  });
});
