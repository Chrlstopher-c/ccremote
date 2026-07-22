// Le socle du déterminisme : si l'horloge n'est pas reproductible,
// aucun injecteur ne l'est. Aucun test de ce fichier ne dépend du temps réel.

import { describe, expect, test } from 'bun:test';
import { HorlogeSimulee } from './horloge-simulee.ts';
import { avancerAsync, vidangerMicrotaches } from './pompe.ts';

describe('HorlogeSimulee — temps contrôlé', () => {
  test('part de zéro et n’avance que sur demande', () => {
    const horloge = new HorlogeSimulee();
    expect(horloge.maintenant()).toBe(0);
    horloge.avancer(500);
    expect(horloge.maintenant()).toBe(500);
  });

  test('une minuterie se déclenche à son échéance exacte', () => {
    const horloge = new HorlogeSimulee();
    const instants: number[] = [];
    horloge.planifier(100, () => instants.push(horloge.maintenant()));
    horloge.avancer(99);
    expect(instants).toEqual([]);
    horloge.avancer(1);
    expect(instants).toEqual([100]);
  });

  test('ordre total stable : échéance croissante, id croissant à égalité', () => {
    const horloge = new HorlogeSimulee();
    const ordre: string[] = [];
    horloge.planifier(50, () => ordre.push('b50'));
    horloge.planifier(10, () => ordre.push('a10'));
    horloge.planifier(50, () => ordre.push('c50'));
    horloge.avancer(100);
    expect(ordre).toEqual(['a10', 'b50', 'c50']);
  });

  test('annuler empêche le déclenchement et reste idempotent', () => {
    const horloge = new HorlogeSimulee();
    let tirs = 0;
    const annuler = horloge.planifier(10, () => (tirs += 1));
    annuler();
    annuler();
    horloge.avancer(1000);
    expect(tirs).toBe(0);
    expect(horloge.minuteriesEnAttente()).toBe(0);
  });

  test('prochaineEcheance expose la plus petite échéance active', () => {
    const horloge = new HorlogeSimulee();
    expect(horloge.prochaineEcheance()).toBeNull();
    horloge.planifier(80, () => {});
    horloge.planifier(20, () => {});
    expect(horloge.prochaineEcheance()).toBe(20);
  });

  test('avancerA ne recule jamais', () => {
    const horloge = new HorlogeSimulee();
    horloge.avancer(300);
    horloge.avancerA(100);
    expect(horloge.maintenant()).toBe(300);
  });

  test('attendre ne se résout pas sans avancée du temps simulé', async () => {
    const horloge = new HorlogeSimulee();
    let resolu = false;
    void horloge.attendre(1000).then(() => (resolu = true));
    await vidangerMicrotaches();
    expect(resolu).toBe(false);
    await avancerAsync(horloge, 1000);
    expect(resolu).toBe(true);
  });

  test('avancerAsync déroule une chaîne d’attentes successives', async () => {
    const horloge = new HorlogeSimulee();
    const etapes: number[] = [];
    const chaine = (async (): Promise<void> => {
      await horloge.attendre(100);
      etapes.push(horloge.maintenant());
      await horloge.attendre(250);
      etapes.push(horloge.maintenant());
    })();
    await avancerAsync(horloge, 400);
    await chaine;
    expect(etapes).toEqual([100, 350]);
  });

  test('deux exécutions du même scénario donnent la même trace', async () => {
    const scenario = async (): Promise<string> => {
      const horloge = new HorlogeSimulee();
      const trace: string[] = [];
      horloge.planifier(30, () => trace.push(`a@${horloge.maintenant()}`));
      horloge.planifier(30, () => trace.push(`b@${horloge.maintenant()}`));
      void horloge.attendre(70).then(() => trace.push(`c@${horloge.maintenant()}`));
      await avancerAsync(horloge, 200);
      return trace.join(',');
    };
    expect(await scenario()).toBe(await scenario());
  });
});
