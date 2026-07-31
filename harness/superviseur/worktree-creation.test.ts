/**
 * `☠` Panne MESURÉE en prod le 2026-08-01, au tout premier mandat de création de
 * projet lancé par Chris.
 *
 * L'orchestrateur avait proposé « créer de zéro le projet `lumen` » — un mandat
 * parfaitement légitime — et `/mnt/projects/lumen` n'existait pas. `spawn`
 * échoue alors en ENOENT, mais le SDK rend un diagnostic ENTIÈREMENT FAUX :
 *
 *   « Claude Code native binary … exists but failed to launch. This usually
 *     means the binary does not match this system's libc — musl vs glibc … »
 *
 * Le binaire était sain (`--version` répond, ELF glibc correct). Sans les logs,
 * la piste évidente était le binaire, la libc, une réinstallation du SDK : des
 * heures de recherche pour un répertoire manquant.
 *
 * Ces tests figent le comportement qui rend cette panne impossible.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SuperviseurWorkers } from './superviseur-workers.ts';
import { CompteurRelances } from '../relance/compteur-relances.ts';

let racine: string;

function superviseurSur(racineProjets: string): SuperviseurWorkers {
  return new SuperviseurWorkers({
    compteurRelances: new CompteurRelances(),
    racineProjets,
  } as never);
}

/** Atteint la garde privée par le seul chemin réel : `demarrer()`. */
async function tenterDemarrage(sup: SuperviseurWorkers, cwd: string): Promise<void> {
  try {
    await sup.demarrer({
      missionId: 'm-worktree',
      epoch: 1,
      promptInitial: 'bonjour',
      spec: { sessionId: 'sess-1', cwd, mandate: 'test', deniedToolPatterns: [] },
    } as never);
  } catch {
    // Le spawn réel échoue : c'est attendu et hors sujet. Ce qui nous intéresse
    // est ce qui s'est passé AVANT lui, sur le système de fichiers.
  }
}

beforeEach(() => {
  racine = mkdtempSync(join(tmpdir(), 'worktree-'));
});

afterEach(() => rmSync(racine, { recursive: true, force: true }));

describe('un mandat sur un projet qui n’existe pas encore', () => {
  test('le worktree est CRÉÉ, au lieu de faire échouer le spawn en ENOENT', async () => {
    const cwd = join(racine, 'lumen');
    expect(existsSync(cwd)).toBe(false);

    await tenterDemarrage(superviseurSur(racine), cwd);

    // `☠` LE test de la panne du 01/08. Sans cette création, « créer de zéro le
    // projet X » est un mandat que le harness ne peut structurellement pas
    // honorer — alors que c'est un usage central du produit.
    expect(existsSync(cwd)).toBe(true);
  });

  test('les répertoires intermédiaires sont créés aussi', async () => {
    const cwd = join(racine, 'client', 'lumen');
    await tenterDemarrage(superviseurSur(racine), cwd);
    expect(existsSync(cwd)).toBe(true);
  });

  test('un worktree existant n’est pas touché', async () => {
    const cwd = join(racine, 'deja-la');
    const { mkdirSync, writeFileSync } = await import('node:fs');
    mkdirSync(cwd, { recursive: true });
    writeFileSync(join(cwd, 'garde.txt'), 'ne doit pas disparaître');

    await tenterDemarrage(superviseurSur(racine), cwd);

    expect(existsSync(join(cwd, 'garde.txt'))).toBe(true);
  });
});

describe('confinement de la création', () => {
  test('hors du répertoire de projets : rien n’est créé', async () => {
    const dehors = join(tmpdir(), `hors-racine-${Date.now()}`);
    await tenterDemarrage(superviseurSur(racine), dehors);

    // `☠` Créer un répertoire n'importe où sur le disque parce qu'un chemin
    // l'a demandé serait une surface qu'on n'a aucune raison d'ouvrir. Le
    // spawn échouera, et le journal portera la vraie cause juste avant.
    expect(existsSync(dehors)).toBe(false);
  });

  test('un `..` qui remonte hors racine ne crée rien non plus', async () => {
    const echappe = join(racine, '..', `evade-${Date.now()}`);
    await tenterDemarrage(superviseurSur(racine), echappe);
    expect(existsSync(echappe)).toBe(false);
  });
});
