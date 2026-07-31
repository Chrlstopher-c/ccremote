/**
 * `☠` Ces tests tournent contre le VRAI `rg` sur un vrai répertoire temporaire.
 * Une doublure aurait validé mon parseur et rien d'autre — or les deux défauts
 * réellement rencontrés le 01/08 (timeout pris pour une absence de ripgrep,
 * racine entière infouillable) venaient tous les deux du process réel, pas de
 * la logique.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rechercherDansProjets } from './recherche-projets.ts';

let racine: string;

beforeEach(() => {
  racine = mkdtempSync(join(tmpdir(), 'recherche-'));
  mkdirSync(join(racine, 'projet-a', 'src'), { recursive: true });
  writeFileSync(join(racine, 'projet-a', 'src', 'index.ts'), 'export const cible = 1;\nconst autre = 2;\n');
  writeFileSync(join(racine, 'projet-a', 'README.md'), '# projet\nla cible est ici\n');
  mkdirSync(join(racine, 'projet-b'), { recursive: true });
  writeFileSync(join(racine, 'projet-b', 'ailleurs.ts'), 'const cible = 3;\n');
  mkdirSync(join(racine, 'projet-a', 'node_modules', 'paquet'), { recursive: true });
  writeFileSync(join(racine, 'projet-a', 'node_modules', 'paquet', 'index.js'), 'var cible = 99;\n');
});

afterEach(() => rmSync(racine, { recursive: true, force: true }));

describe('trouver', () => {
  test('rend le fichier, la ligne et le texte', async () => {
    const r = await rechercherDansProjets(racine, 'cible', 'projet-a');
    expect(r.occurrences.length).toBeGreaterThan(0);
    const o = r.occurrences[0];
    expect(o?.fichier).toContain('projet-a');
    expect(o?.ligne).toBeGreaterThan(0);
    expect(o?.texte).toContain('cible');
  });

  test('reste borné au projet demandé', async () => {
    const r = await rechercherDansProjets(racine, 'cible', 'projet-a');
    expect(r.occurrences.every((o) => !o.fichier.includes('projet-b'))).toBe(true);
  });

  test('n’explore pas node_modules', async () => {
    // `☠` Sans cette exclusion, un motif courant rend des centaines
    // d'occurrences de dépendances et le vrai résultat se noie dedans.
    const r = await rechercherDansProjets(racine, 'cible', 'projet-a');
    expect(r.occurrences.every((o) => !o.fichier.includes('node_modules'))).toBe(true);
  });

  test('« aucune occurrence » est une réponse, pas une erreur', async () => {
    const r = await rechercherDansProjets(racine, 'ZZZ_introuvable_42', 'projet-a');
    expect(r.occurrences).toHaveLength(0);
    expect(r.note).toBe('aucune occurrence');
  });
});

describe('refus', () => {
  test('sans chemin : on exige un projet, et on dit lequel chercher', async () => {
    // `☠` Mesuré le 01/08 : `rg` sur /mnt/projects dépasse deux minutes même en
    // excluant node_modules et .git. Un défaut « toute la racine » aurait rendu
    // un timeout — ni réponse, ni refus compréhensible — au premier usage naturel.
    const r = await rechercherDansProjets(racine, 'cible');
    expect(r.occurrences).toHaveLength(0);
    expect(r.note).toContain('précise le projet');
    expect(r.note).toContain('explorer_projets');
  });

  test('hors racine : refusé, avec la racine dans le message', async () => {
    const r = await rechercherDansProjets(racine, 'root', '/etc');
    expect(r.note).toContain('hors du répertoire de projets');
  });

  test('motif vide : refusé sans lancer de process', async () => {
    expect((await rechercherDansProjets(racine, '   ', 'projet-a')).note).toContain('motif vide');
  });
});

describe('bornes', () => {
  test('le plafond demandé est respecté', async () => {
    const r = await rechercherDansProjets(racine, 'cible', 'projet-a', 1);
    expect(r.occurrences).toHaveLength(1);
    expect(r.note).toContain('affine le motif');
  });

  test('un motif contenant des métacaractères shell est cherché, jamais exécuté', async () => {
    writeFileSync(join(racine, 'projet-a', 'piege.txt'), 'valeur $(echo INJECTE) ici\n');
    const r = await rechercherDansProjets(racine, '\\$\\(echo INJECTE\\)', 'projet-a');
    // `☠` La preuve que `Bun.spawn` en tableau n'ouvre pas de shell : le motif
    // est trouvé LITTÉRALEMENT dans le fichier. S'il avait été exécuté, on
    // chercherait « INJECTE » et ce test ne trouverait pas la parenthèse.
    expect(r.occurrences.length).toBeGreaterThan(0);
    expect(r.occurrences[0]?.texte).toContain('$(echo INJECTE)');
  });

  test('une ligne interminable est tronquée, pas écartée', async () => {
    writeFileSync(join(racine, 'projet-a', 'minifie.js'), `var x="${'A'.repeat(5000)}cible";\n`);
    const r = await rechercherDansProjets(racine, 'cible', 'projet-a');
    expect(r.occurrences.every((o) => o.texte.length <= 241)).toBe(true);
  });
});
