import { describe, expect, test } from 'bun:test';
import { creerHorlogeAvecGigue } from './horloge-avec-gigue.ts';
import type { HorlogeTransport } from '../../transport/horloge-transport.ts';

function horlogeBaseEnregistreuse(): HorlogeTransport & { delais: number[] } {
  const delais: number[] = [];
  return {
    delais,
    planifier(delaiMs, action) {
      delais.push(delaiMs);
      action();
      return () => {};
    },
  };
}

describe('creerHorlogeAvecGigue', () => {
  test('☠ CASSE mesuré : sans gigue (aléatoire fixé à 0.5, milieu de la plage), le délai est inchangé', () => {
    const base = horlogeBaseEnregistreuse();
    const horloge = creerHorlogeAvecGigue({ horlogeBase: base, aleatoire: () => 0.5 });
    horloge.planifier(1000, () => {});
    expect(base.delais).toEqual([1000]);
  });

  test('applique une gigue négative avec un aléatoire à 0', () => {
    const base = horlogeBaseEnregistreuse();
    const horloge = creerHorlogeAvecGigue({ horlogeBase: base, fractionGigue: 0.2, aleatoire: () => 0 });
    horloge.planifier(1000, () => {});
    expect(base.delais).toEqual([800]); // -20 %
  });

  test('applique une gigue positive avec un aléatoire à 1', () => {
    const base = horlogeBaseEnregistreuse();
    const horloge = creerHorlogeAvecGigue({ horlogeBase: base, fractionGigue: 0.2, aleatoire: () => 1 });
    horloge.planifier(1000, () => {});
    expect(base.delais).toEqual([1200]); // +20 %
  });

  test('deux tentatives successives avec un aléatoire réel produisent des délais DIFFÉRENTS (gigue per-attempt, pas per-process)', () => {
    const base = horlogeBaseEnregistreuse();
    const horloge = creerHorlogeAvecGigue({ horlogeBase: base }); // Math.random() réel
    horloge.planifier(2000, () => {});
    horloge.planifier(2000, () => {});
    horloge.planifier(2000, () => {});
    // Probabilité de 3 tirages Math.random() identiques : négligeable.
    expect(new Set(base.delais).size).toBeGreaterThan(1);
  });

  test('le délai ne descend jamais sous 0 même avec une fraction de gigue extrême', () => {
    const base = horlogeBaseEnregistreuse();
    const horloge = creerHorlogeAvecGigue({ horlogeBase: base, fractionGigue: 2, aleatoire: () => 0 });
    horloge.planifier(100, () => {});
    expect(base.delais[0]).toBeGreaterThanOrEqual(0);
  });

  test("l'annulation retournée par planifier() propage celle de l'horloge de base", () => {
    let annulee = false;
    const base: HorlogeTransport = {
      planifier: (_delaiMs, _action) => () => {
        annulee = true;
      },
    };
    const horloge = creerHorlogeAvecGigue({ horlogeBase: base });
    const annuler = horloge.planifier(500, () => {});
    annuler();
    expect(annulee).toBe(true);
  });
});
