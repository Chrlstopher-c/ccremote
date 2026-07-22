import { describe, expect, test } from 'bun:test';
import { tousPaliersInspectes, verifierPalier } from './paliers.ts';
import { ETAT_PALIERS_INITIAL, PALIERS_PAR_DEFAUT } from './types.ts';
import type { EtatPaliers } from './types.ts';

describe('verifierPalier', () => {
  test('ne déclenche rien sous le premier palier', () => {
    const resultat = verifierPalier(5, PALIERS_PAR_DEFAUT, ETAT_PALIERS_INITIAL);
    expect(resultat.declenche).toBe(false);
    expect(resultat.palierUsd).toBeNull();
  });

  test('déclenche au premier palier franchi (12 $)', () => {
    const resultat = verifierPalier(12, PALIERS_PAR_DEFAUT, ETAT_PALIERS_INITIAL);
    expect(resultat.declenche).toBe(true);
    expect(resultat.palierUsd).toBe(12);
    expect(resultat.nouvelEtat.dernierPalierInspecteIndex).toBe(0);
  });

  test('ne redéclenche pas le même palier déjà inspecté', () => {
    const premier = verifierPalier(12, PALIERS_PAR_DEFAUT, ETAT_PALIERS_INITIAL);
    const second = verifierPalier(15, PALIERS_PAR_DEFAUT, premier.nouvelEtat);
    expect(second.declenche).toBe(false);
  });

  test('plusieurs paliers franchis d’un coup ⇒ ne rend que le plus haut, marque tous inspectés', () => {
    const resultat = verifierPalier(75, PALIERS_PAR_DEFAUT, ETAT_PALIERS_INITIAL);
    expect(resultat.palierUsd).toBe(70);
    expect(resultat.nouvelEtat.dernierPalierInspecteIndex).toBe(3); // index de 70 $

    // aucun redéclenchement rétroactif sur 12/30/50 sautés
    const suivant = verifierPalier(76, PALIERS_PAR_DEFAUT, resultat.nouvelEtat);
    expect(suivant.declenche).toBe(false);
  });

  test('déclenche le palier suivant une fois le précédent inspecté', () => {
    const premier = verifierPalier(12, PALIERS_PAR_DEFAUT, ETAT_PALIERS_INITIAL);
    const second = verifierPalier(30, PALIERS_PAR_DEFAUT, premier.nouvelEtat);
    expect(second.declenche).toBe(true);
    expect(second.palierUsd).toBe(30);
  });

  test('paliers configurés hors ordre : trié avant comparaison', () => {
    const config = { seuilsUsd: [50, 12, 30] };
    const resultat = verifierPalier(12, config, ETAT_PALIERS_INITIAL);
    expect(resultat.palierUsd).toBe(12);
  });
});

describe('tousPaliersInspectes', () => {
  test('false tant que tous les paliers ne sont pas franchis', () => {
    expect(tousPaliersInspectes(PALIERS_PAR_DEFAUT, ETAT_PALIERS_INITIAL)).toBe(false);
  });

  test('true une fois le dernier palier atteint', () => {
    const etat: EtatPaliers = { dernierPalierInspecteIndex: PALIERS_PAR_DEFAUT.seuilsUsd.length - 1 };
    expect(tousPaliersInspectes(PALIERS_PAR_DEFAUT, etat)).toBe(true);
  });
});
