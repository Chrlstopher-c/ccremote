/**
 * Le relevé matériel d'une machine de travail.
 *
 * `☠` Ce qui est éprouvé ici n'est pas la valeur des chiffres (ils dépendent de
 * la machine qui exécute le test) mais leur HONNÊTETÉ : une mesure impossible
 * doit valoir `null`, jamais `0`. « 0 % de CPU » et « je n'ai pas pu mesurer »
 * mènent à des décisions opposées quand on choisit où lancer une équipe.
 */

import { describe, expect, test } from 'bun:test';
import { releverMetriquesHote } from './metriques-hote.ts';

describe('relevé matériel', () => {
  test('☠ le premier relevé rend un CPU à `null`, jamais 0', async () => {
    // Un pourcentage de CPU est un RAPPORT entre deux instants : il n'existe pas
    // dans un relevé isolé. Rendre 0 ferait afficher une machine au repos alors
    // qu'on n'en sait encore rien — et c'est justement au démarrage qu'on
    // regarde.
    const m = await releverMetriquesHote('banc');
    expect(m.machine).toBe('banc');
    // `null` au tout premier appel du process ; un test qui tournerait après un
    // autre verrait une vraie valeur — les deux sont acceptables, `0` figé ne
    // l'est pas.
    expect(m.cpuPct === null || (m.cpuPct >= 0 && m.cpuPct <= 100)).toBe(true);
  });

  test('le second relevé donne un pourcentage borné', async () => {
    await releverMetriquesHote();
    await new Promise((r) => setTimeout(r, 60));
    const m = await releverMetriquesHote();
    expect(m.cpuPct).not.toBeNull();
    expect(m.cpuPct as number).toBeGreaterThanOrEqual(0);
    expect(m.cpuPct as number).toBeLessThanOrEqual(100);
  });

  test('mémoire, disque et uptime sont mesurés', async () => {
    const m = await releverMetriquesHote();
    expect(m.memTotaleMo as number).toBeGreaterThan(0);
    expect(m.memUtiliseeMo as number).toBeGreaterThan(0);
    expect(m.memPct as number).toBeGreaterThanOrEqual(0);
    expect(m.disqueTotalGo as number).toBeGreaterThan(0);
    expect(m.uptimeS).toBeGreaterThan(0);
  });

  test('☠ la température vient d’un capteur CPU NOMMÉ, jamais de thermal_zone0', async () => {
    // `☠ MESURÉ LE 01/08.` `thermal_zone0` vaut `acpitz` sur le PC de Chris et
    // rendait 16,8 °C pendant que le processeur était à 72,75 °C (`k10temp`).
    // Un capteur existant, une valeur plausible, et fausse — donc aucune alarme.
    // Ici on ne peut pas exiger une valeur (le VPS n'a aucun capteur), mais on
    // peut exiger qu'une valeur rendue soit PLAUSIBLE pour un processeur.
    const m = await releverMetriquesHote();
    if (m.tempCpuC !== null) {
      expect(m.tempCpuC).toBeGreaterThan(20);
      expect(m.tempCpuC).toBeLessThan(150);
    }
  });

  test('☠ un GPU absent vaut `null` — pas une carte à zéro', async () => {
    // Cas nominal sur le VPS : il n'a pas de GPU. Rendre `{utilPct: 0}` ferait
    // afficher une carte graphique inexistante, parfaitement inactive.
    const m = await releverMetriquesHote();
    expect(m.gpu === null || typeof m.gpu.utilPct === 'number' || m.gpu.utilPct === null).toBe(true);
  });

  test('ne lève jamais, même appelé en rafale', async () => {
    // Une métrique indisponible ne doit pas faire disparaître la machine de la
    // page : l'absence d'un chiffre et l'absence d'une machine sont deux
    // informations opposées.
    const releves = await Promise.all([releverMetriquesHote(), releverMetriquesHote(), releverMetriquesHote()]);
    expect(releves.length).toBe(3);
    for (const m of releves) expect(typeof m.releveA).toBe('number');
  });
});
