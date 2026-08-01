/**
 * `☠` Ce fichier existe pour UNE raison : empêcher le plafond de redescendre sur
 * l'échelle d'inspection. C'est la panne mesurée en prod le 01/08 — plafond et
 * premier palier tous deux à 12 $, équipe tuée à l'instant précis où le juge
 * devait la regarder, huit paliers inatteignables. Le défaut n'était visible
 * dans aucun des deux fichiers : il n'existait que dans leur RELATION.
 */

import { describe, expect, test } from 'bun:test';
import { PALIERS_PAR_DEFAUT } from '../anti-boucle/types.ts';
import {
  DERNIER_PALIER_USD,
  PLAFOND_EQUIPE_USD,
  plafondEffectifUsd,
  plafondSousLePremierPalier,
} from './budget-equipe.ts';

describe('le plafond ne peut pas retomber sur l’échelle', () => {
  test('☠ LE test : le plafond dépasse le DERNIER palier', () => {
    // Sinon les derniers paliers ne servent à rien : l'équipe est coupée avant
    // de les atteindre, et l'échelle n'est plus qu'une décoration.
    expect(PLAFOND_EQUIPE_USD).toBeGreaterThan(DERNIER_PALIER_USD);
  });

  test('☠ et il ne coupe évidemment pas avant la PREMIÈRE inspection', () => {
    expect(plafondSousLePremierPalier(PLAFOND_EQUIPE_USD)).toBe(false);
  });

  test('tous les paliers sont donc atteignables', () => {
    for (const seuil of PALIERS_PAR_DEFAUT.seuilsUsd) {
      expect(seuil).toBeLessThan(PLAFOND_EQUIPE_USD);
    }
  });

  test('l’échelle reste croissante — un palier qui recule ne serait jamais franchi', () => {
    const seuils = [...PALIERS_PAR_DEFAUT.seuilsUsd];
    expect(seuils).toEqual([...seuils].sort((a, b) => a - b));
  });
});

describe('plafondEffectifUsd', () => {
  test('un mandat sans budget prend le plafond dérivé', () => {
    expect(plafondEffectifUsd(null)).toBe(PLAFOND_EQUIPE_USD);
    expect(plafondEffectifUsd(0)).toBe(PLAFOND_EQUIPE_USD);
    expect(plafondEffectifUsd(undefined)).toBe(PLAFOND_EQUIPE_USD);
  });

  test('un budget explicite est respecté, même petit', () => {
    // Choix légitime pour une mission courte — mais l'appelant doit savoir ce
    // qu'il fait, d'où `plafondSousLePremierPalier`.
    expect(plafondEffectifUsd(5)).toBe(5);
    expect(plafondSousLePremierPalier(5)).toBe(true);
  });

  test('un budget négatif ne passe pas pour une consigne — il retombe au plafond', () => {
    expect(plafondEffectifUsd(-3)).toBe(PLAFOND_EQUIPE_USD);
  });
});
