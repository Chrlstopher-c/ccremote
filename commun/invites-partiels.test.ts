// Réglages partiels d'un invité : seuls les champs donnés changent, `acces` se fusionne, `modeles` se remplace entier.
import { describe, expect, test } from 'bun:test';
import { fusionnerReglages, ReglagesPartiels, reglagesParDefaut } from './invites.ts';

const ACTUELS = reglagesParDefaut('tour');

describe('réglages partiels', () => {
  test('un seul champ donné : les autres restent tels quels', () => {
    const r = fusionnerReglages(ACTUELS, ReglagesPartiels.parse({ part5h: 40 }));
    expect(r).toEqual({ ...ACTUELS, part5h: 40 });
  });

  test('acces fusionné champ par champ', () => {
    const r = fusionnerReglages(ACTUELS, ReglagesPartiels.parse({ acces: { terminaux: false, fichiersHors: true } }));
    expect(r.acces).toEqual({ ...ACTUELS.acces, fichiersHors: true });
    expect(ReglagesPartiels.parse({ acces: { modules: true } }).acces).toEqual({ modules: true });
  });

  test('modeles donné : remplace la liste entière (les familles absentes deviennent interdites)', () => {
    const r = fusionnerReglages(ACTUELS, ReglagesPartiels.parse({ modeles: { opus: ['low', 'medium'] } }));
    expect(r.modeles).toEqual({ opus: ['low', 'medium'] });
  });

  test('partSemaine peut être remis à null (sans plafond hebdomadaire)', () => {
    expect(fusionnerReglages(ACTUELS, ReglagesPartiels.parse({ partSemaine: null })).partSemaine).toBeNull();
  });

  test('une valeur hors bornes est refusée par le schéma partiel', () => {
    expect(ReglagesPartiels.safeParse({ part5h: 101 }).success).toBe(false);
    expect(ReglagesPartiels.parse({ acces: { inconnu: true } }).acces).toEqual({});
  });

  test('vide : aucun changement', () => {
    expect(fusionnerReglages(ACTUELS, ReglagesPartiels.parse({}))).toEqual(ACTUELS);
  });
});
