// Responsabilité : lister les projets présents sur la machine (sous-dossiers des racines qui ressemblent à un projet).
import { existsSync, readdirSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { Projet } from '../../commun/session.ts';

const MARQUEURS = ['.git', 'package.json', 'Cargo.toml', 'pyproject.toml', 'Package.swift', 'go.mod', 'project.godot'];

export function estProjet(chemin: string): boolean {
  return MARQUEURS.some((m) => existsSync(join(chemin, m)));
}

export function decouvrirProjets(machine: string, racines: readonly string[]): Projet[] {
  const vus = new Map<string, { projet: Projet; mtime: number }>();
  for (const racine of racines) {
    for (const chemin of sousDossiers(racine)) {
      if (vus.has(chemin) || !estProjet(chemin)) continue;
      vus.set(chemin, { projet: { machine, chemin, nom: basename(chemin) }, mtime: statSync(chemin).mtimeMs });
    }
  }
  return [...vus.values()].sort((a, b) => b.mtime - a.mtime).map((v) => v.projet);
}

function sousDossiers(racine: string): string[] {
  try {
    return readdirSync(racine, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
      .map((e) => join(racine, e.name));
  } catch {
    return []; // racine absente sur cette machine (disque non monté) : rien à proposer, pas une panne
  }
}
