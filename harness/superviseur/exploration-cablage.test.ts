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

/**
 * ☠ Même motif, même garde : `rechercherDansProjets` pouvait très bien être
 * correct et n'être appelé par personne. Ce test part du HANDLER réellement
 * invoqué (`CanalControle.traiter`), pas de la fonction — c'est la seule forme
 * qui aurait attrapé la panne de 2026-07-23, et donc la seule qui vaille ici.
 */
describe('recherche dans les projets — câblage réel canal ⟷ superviseur', () => {
  test('☠ le canal obtient de VRAIES occurrences, pas « recherche non câblée »', async () => {
    const racine = await mkdtemp(join(tmpdir(), 'ccremote-recherche-'));
    await mkdir(join(racine, 'vela'));
    await Bun.write(join(racine, 'vela', 'main.ts'), 'export const MOTIF_CIBLE = 1;\n');

    const reponse = await canalSur(racine).traiter({
      opId: 'op-r1',
      operation: { type: 'rechercher_projets', motif: 'MOTIF_CIBLE', chemin: 'vela' },
    });

    expect(reponse.ok).toBe(true);
    expect(reponse.rechercheProjets?.occurrences.length).toBeGreaterThan(0);
    expect(reponse.rechercheProjets?.occurrences[0]?.fichier).toContain('main.ts');
  });

  test('un refus de recherche remonte sa raison, jamais un résultat vide muet', async () => {
    const racine = await mkdtemp(join(tmpdir(), 'ccremote-recherche-'));
    const reponse = await canalSur(racine).traiter({
      opId: 'op-r2',
      operation: { type: 'rechercher_projets', motif: 'peu importe' },
    });
    // `☠` « aucune occurrence » et « je n'ai pas cherché » mènent à des
    // décisions opposées : l'orchestrateur conclurait que le code n'existe pas.
    expect(reponse.detail).toContain('précise le projet');
  });

  test('la recherche N’EST PAS servie depuis le cache d’idempotence', async () => {
    const racine = await mkdtemp(join(tmpdir(), 'ccremote-recherche-'));
    await mkdir(join(racine, 'vela'));
    await Bun.write(join(racine, 'vela', 'a.ts'), 'rien ici\n');
    const canal = canalSur(racine);
    const op = { opId: 'op-r3', operation: { type: 'rechercher_projets' as const, motif: 'APPARU', chemin: 'vela' } };

    expect((await canal.traiter(op)).rechercheProjets?.occurrences).toHaveLength(0);
    await Bun.write(join(racine, 'vela', 'a.ts'), 'const APPARU = 1;\n');
    // `☠` Même `opId` : servi depuis le cache, l'orchestrateur relirait l'état
    // du dépôt tel qu'il était AVANT le travail d'une équipe — et conclurait
    // qu'elle n'a rien fait.
    expect((await canal.traiter(op)).rechercheProjets?.occurrences.length).toBeGreaterThan(0);
  });
});
