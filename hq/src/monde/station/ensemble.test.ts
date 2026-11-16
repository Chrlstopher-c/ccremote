import { describe, expect, test } from 'bun:test';

import { attribuer, EMPLACEMENTS } from './ensemble';
import { construirePiece } from './piece';

describe('vue station', () => {
  test('un compartiment par projet, clients et agents sur l anneau vert', () => {
    const a = attribuer(['stockiop', 'agent-hq', 'agent-hq', 'roblox-elevage']);
    expect(a.map((x) => x.projet)).toEqual(['stockiop', 'agent-hq', 'roblox-elevage']);
    expect(a.find((x) => x.projet === 'stockiop')?.emplacement.anneau).toBe('vert');
    expect(a.find((x) => x.projet === 'roblox-elevage')?.emplacement.anneau).toBe('violet');
  });

  test('jamais deux projets au même endroit, et pas plus de projets que de compartiments', () => {
    const projets = Array.from({ length: 30 }, (_, i) => `projet-${i}`);
    const a = attribuer(projets);
    expect(a).toHaveLength(EMPLACEMENTS.length);
    expect(new Set(a.map((x) => `${x.emplacement.x},${x.emplacement.y}`)).size).toBe(EMPLACEMENTS.length);
  });
});

describe('vue pièce', () => {
  test('un poste par agent, et l on marche de la coursive à chaque poste', () => {
    const c = construirePiece('stockiop', 3);
    expect(c.postes).toHaveLength(3);
    expect(c.cases.flat().some((k) => k.nature === 'sol')).toBe(true);
  });
});
