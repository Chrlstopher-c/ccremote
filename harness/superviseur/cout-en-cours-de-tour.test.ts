/**
 * `☠` Panne mesurée le 01/08 : « une team qui taffe 15 min, l'orchestrateur voit
 * un usage bloqué à 0 $ constant ». Le coût ne se lisait que sur un message
 * `result`, qui n'arrive qu'à la FIN d'un tour — et l'anti-boucle, nourri au
 * même endroit, n'inspectait donc personne pendant tout ce temps.
 *
 * Ces tests portent sur la propriété qui compte : le coût bouge PENDANT le tour,
 * et il ne redescend jamais.
 */

import { describe, expect, test } from 'bun:test';
import { CollecteurTelemetrie } from './collecteur-telemetrie.ts';

function collecteur(): CollecteurTelemetrie {
  const c = new CollecteurTelemetrie();
  c.ouvrir('m-1', 's-1', 0);
  return c;
}

function cout(c: CollecteurTelemetrie): number {
  return c.tous().find((t) => t.missionId === 'm-1')?.coutUsd ?? -1;
}

describe('coût relevé en cours de tour', () => {
  test('☠ il bouge sans qu’aucun message `result` ne soit arrivé', () => {
    const c = collecteur();
    expect(cout(c)).toBe(0);
    c.poserCout('m-1', 3.42);
    expect(cout(c)).toBe(3.42);
  });

  test('il progresse au fil des relevés', () => {
    const c = collecteur();
    c.poserCout('m-1', 3.42);
    c.poserCout('m-1', 11.90);
    expect(cout(c)).toBe(11.90);
  });

  test('☠ une sonde ratée qui rend 0 n’efface pas le coût réel', () => {
    // C'est le mode de panne le plus coûteux ici : effacer le coût le ferait
    // « refranchir » ses paliers, donc réinspecter l'équipe pour rien — et
    // afficher 0 $ à l'orchestrateur, exactement le défaut qu'on corrige.
    const c = collecteur();
    c.poserCout('m-1', 11.90);
    c.poserCout('m-1', 0);
    expect(cout(c)).toBe(11.90);
  });

  test('☠ un relevé plus BAS est ignoré — un coût ne décroît pas', () => {
    const c = collecteur();
    c.poserCout('m-1', 11.90);
    c.poserCout('m-1', 4.10);
    expect(cout(c)).toBe(11.90);
  });

  test('une valeur non finie ne casse rien et ne s’écrit pas', () => {
    const c = collecteur();
    c.poserCout('m-1', 11.90);
    c.poserCout('m-1', Number.NaN);
    c.poserCout('m-1', Number.POSITIVE_INFINITY);
    expect(cout(c)).toBe(11.90);
  });

  test('un relevé sur une mission inconnue ne lève pas', () => {
    const c = collecteur();
    expect(() => c.poserCout('m-inconnue', 5)).not.toThrow();
  });

  test('☠ un `result` plus bas ne fait pas non plus redescendre le total', () => {
    // Sur une session reprise, le SDK peut repartir d'un total plus faible. Le
    // prendre pour argent comptant referait franchir des paliers déjà inspectés.
    const c = collecteur();
    c.poserCout('m-1', 40);
    c.ingerer('m-1', { type: 'result', total_cost_usd: 12 } as never);
    expect(cout(c)).toBe(40);
  });

  test('un `result` plus haut, lui, fait toujours autorité', () => {
    const c = collecteur();
    c.poserCout('m-1', 12);
    c.ingerer('m-1', { type: 'result', total_cost_usd: 40 } as never);
    expect(cout(c)).toBe(40);
  });
});
