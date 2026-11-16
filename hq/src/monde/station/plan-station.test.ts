import { describe, expect, test } from 'bun:test';

import { chemin, grilleDe } from '../carte/chemin';
import { construireStation, grouper } from './plan-station';

describe('plan de la station', () => {
  test('un pont par catégorie, une pièce par projet, un poste par session', () => {
    const projets = ['stockiop', 'agent-hq', 'agent-hq', 'roblox-elevage'];
    const s = construireStation(projets);
    expect(grouper(projets).map((g) => g.categorie.id)).toEqual(['clients', 'agents', 'jeux']);
    expect(s.ponts).toHaveLength(3);
    expect(s.carte.postes).toHaveLength(4);
    expect(new Set(s.carte.postes.map((p) => `${p.siege.x},${p.siege.y}`)).size).toBe(4);
  });

  test('le premier pont a son café, tous les ponts finissent sur la même colonne de sas', () => {
    const s = construireStation(['stockiop', 'agent-hq']);
    expect(s.ponts[0]?.compartiments.some((c) => c.ilot === 'cafe')).toBe(true);
    expect(new Set(s.ponts.map((p) => p.tube)).size).toBe(1);
  });

  test('on peut marcher de la coursive du premier pont jusqu à un poste du dernier', () => {
    const s = construireStation(['stockiop', 'roblox-elevage']);
    const g = grilleDe(s.carte, {});
    const depart = s.carte.depart;
    const but = s.carte.postes[1]?.debout ?? { x: 0, y: 0 };
    expect(chemin(g, depart, but)?.length ?? 0).toBeGreaterThan(0);
  });
});
