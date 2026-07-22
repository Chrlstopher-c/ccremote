import { describe, expect, test } from 'bun:test';
import { CompteurRelances, PLAFOND_RELANCES_DEFAUT } from './compteur-relances.ts';

describe('CompteurRelances', () => {
  test('démarre à zéro tentative, sous le plafond', () => {
    const compteur = new CompteurRelances();
    const etat = compteur.etat('session-1');
    expect(etat.tentativesEffectuees).toBe(0);
    expect(etat.plafond).toBe(PLAFOND_RELANCES_DEFAUT);
    expect(compteur.sousLePlafond('session-1')).toBe(true);
  });

  test('incrémente uniquement sur enregistrerTentative', () => {
    const compteur = new CompteurRelances(3);
    compteur.enregistrerTentative('session-1');
    compteur.enregistrerTentative('session-1');
    expect(compteur.etat('session-1').tentativesEffectuees).toBe(2);
    expect(compteur.sousLePlafond('session-1')).toBe(true);
  });

  test('atteint le plafond puis reste au-delà', () => {
    const compteur = new CompteurRelances(2);
    compteur.enregistrerTentative('session-1');
    compteur.enregistrerTentative('session-1');
    expect(compteur.sousLePlafond('session-1')).toBe(false);
  });

  test('les compteurs sont isolés par sessionId — une équipe qui boucle n\'affecte pas une autre', () => {
    const compteur = new CompteurRelances(1);
    compteur.enregistrerTentative('session-1');
    expect(compteur.sousLePlafond('session-1')).toBe(false);
    expect(compteur.sousLePlafond('session-2')).toBe(true);
  });

  test('reinitialiser efface le compteur', () => {
    const compteur = new CompteurRelances(1);
    compteur.enregistrerTentative('session-1');
    compteur.reinitialiser('session-1');
    expect(compteur.etat('session-1').tentativesEffectuees).toBe(0);
  });

  test('plafond par équipe surchargeable à la première lecture', () => {
    const compteur = new CompteurRelances(PLAFOND_RELANCES_DEFAUT);
    const etat = compteur.etat('session-x', 10);
    expect(etat.plafond).toBe(10);
  });
});
