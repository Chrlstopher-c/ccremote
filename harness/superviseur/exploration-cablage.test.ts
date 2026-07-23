import { describe, expect, test } from 'bun:test';
import { mkdtemp, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CanalControle } from './canal-controle.ts';
import { SuperviseurWorkers } from './superviseur-workers.ts';
import { CompteurRelances } from '../relance/compteur-relances.ts';

/**
 * ☠ Test d'ASSEMBLAGE, pas d'unité. `explorerProjets` était écrit, correct, et
 * appelé par personne : `SuperviseurWorkers` importait la fonction et gardait la
 * racine, sans jamais exposer la méthode que `CanalControle` interroge. Aucun
 * test unitaire ne pouvait le voir — chacun testait sa moitié. C'est le même
 * motif que « garde-fou sur port optionnel = garde-fou éteint » : seul un test
 * qui traverse la frontière l'attrape.
 */
async function racineAvecProjets(): Promise<string> {
  const racine = await mkdtemp(join(tmpdir(), 'ccremote-projets-'));
  await mkdir(join(racine, 'vela'));
  await mkdir(join(racine, 'ccremote'));
  return racine;
}

function canalSur(racineProjets: string): CanalControle {
  const superviseur = new SuperviseurWorkers({
    compteurRelances: new CompteurRelances(),
    racineProjets,
  } as never);
  return new CanalControle(superviseur);
}

describe('exploration des projets — câblage réel canal ⟷ superviseur', () => {
  test('☠ le canal obtient une VRAIE arborescence — avant : « exploration non câblée »', async () => {
    const racine = await racineAvecProjets();
    const reponse = await canalSur(racine).traiter({ opId: 'op-1', operation: { type: 'explorer_projets' } });
    expect(reponse.ok).toBe(true);
    expect(reponse.detail).toBeUndefined();
    expect(reponse.explorationProjets?.entrees.map((e) => e.nom).sort()).toEqual(['ccremote', 'vela']);
  });

  test('un sous-chemin est exploré', async () => {
    const racine = await racineAvecProjets();
    const reponse = await canalSur(racine).traiter({
      opId: 'op-2',
      operation: { type: 'explorer_projets', chemin: 'vela' },
    });
    expect(reponse.ok).toBe(true);
    expect(reponse.explorationProjets?.chemin).toBe(join(racine, 'vela'));
  });

  test('☠ un chemin HORS de la racine est refusé — la borne ne doit pas tomber avec le câblage', async () => {
    const racine = await racineAvecProjets();
    const reponse = await canalSur(racine).traiter({
      opId: 'op-3',
      operation: { type: 'explorer_projets', chemin: '../../etc' },
    });
    expect(reponse.explorationProjets?.entrees).toEqual([]);
    expect(reponse.explorationProjets?.note).toContain('refusé');
  });
});
