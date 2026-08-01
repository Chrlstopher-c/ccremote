/**
 * `☠ MESURÉ LE 01/08.` Chris authentifie `compte-b` sur le VPS quelques heures
 * après le dernier déploiement. Le compte est sur le disque, connecté,
 * fonctionnel — et INUTILISABLE : `CCREMOTE_PC_COMPTES`, écrite au déploiement,
 * ne le mentionnait pas. Sonde de quotas aveugle, et surtout répertoire non
 * résolu (H-44), donc pré-vol en échec et équipe refusée.
 *
 * Ces tests verrouillent la règle qui supprime cette classe de panne : la
 * machine OBSERVE ses comptes, elle ne les reçoit pas d'une liste figée.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { analyserComptesEnv, comptesDeLaMachine, decouvrirComptes } from './decouverte-comptes.ts';

let racine: string;

async function poserCompte(id: string, avecCredentials = true): Promise<void> {
  const d = join(racine, id);
  await mkdir(d, { recursive: true });
  if (avecCredentials) await writeFile(join(d, '.credentials.json'), '{}');
}

beforeEach(async () => {
  racine = await mkdtemp(join(tmpdir(), 'comptes-'));
});

afterEach(async () => {
  await rm(racine, { recursive: true, force: true });
});

describe('découverte des comptes sur le disque', () => {
  test('☠ un compte authentifié APRÈS le déploiement est vu', async () => {
    await poserCompte('compte-a');
    expect((await decouvrirComptes(racine)).map((c) => c.id)).toEqual(['compte-a']);
    // Le `/login` de Chris, plus tard, sans redéploiement.
    await poserCompte('compte-b');
    expect((await decouvrirComptes(racine)).map((c) => c.id)).toEqual(['compte-a', 'compte-b']);
  });

  test('☠ un répertoire SANS credentials n’est pas annoncé disponible', async () => {
    // L'annoncer ferait échouer une équipe au démarrage — pire que de ne rien
    // annoncer, parce que le mandat est déjà consommé à ce moment-là.
    await poserCompte('compte-a');
    await poserCompte('compte-vide', false);
    expect((await decouvrirComptes(racine)).map((c) => c.id)).toEqual(['compte-a']);
  });

  test('l’ordre est stable, jamais celui du système de fichiers', async () => {
    await poserCompte('compte-z');
    await poserCompte('compte-a');
    expect((await decouvrirComptes(racine)).map((c) => c.id)).toEqual(['compte-a', 'compte-z']);
  });

  test('racine absente ⇒ liste vide, jamais une exception', async () => {
    // Une machine sans compte doit démarrer quand même : elle sert aussi à
    // l'inventaire et à l'exploration de projets.
    expect(await decouvrirComptes(join(racine, 'nexistepas'))).toEqual([]);
  });

  test('le chemin rendu est celui de CETTE machine', async () => {
    await poserCompte('compte-a');
    expect((await decouvrirComptes(racine))[0]?.configDir).toBe(join(racine, 'compte-a'));
  });
});

describe('surcharge explicite', () => {
  test('renseignée, elle l’emporte sur le disque', async () => {
    await poserCompte('compte-a');
    const r = await comptesDeLaMachine(racine, 'autre=/ailleurs/autre');
    expect(r).toEqual([{ id: 'autre', configDir: '/ailleurs/autre' }]);
  });

  test('absente ou vide, le disque fait foi', async () => {
    await poserCompte('compte-a');
    expect((await comptesDeLaMachine(racine, undefined)).map((c) => c.id)).toEqual(['compte-a']);
    expect((await comptesDeLaMachine(racine, '')).map((c) => c.id)).toEqual(['compte-a']);
  });

  test('le format hérité `id=chemin,…` reste analysé tel quel', () => {
    expect(analyserComptesEnv('a=/x/a,b=/y/b')).toEqual([
      { id: 'a', configDir: '/x/a' },
      { id: 'b', configDir: '/y/b' },
    ]);
    expect(analyserComptesEnv('n_importe_quoi')).toEqual([]);
  });
});
