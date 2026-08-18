/**
 * Persistance SQLite du registre (dette n°1, TODO.md). `:memory:` partout — pas de
 * fichier réel dans les tests unitaires.
 */

import { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { WorkerSpec } from '../workers/index.ts';
import { PersistanceRegistreSqlite } from './persistance-registre.ts';

function specFactice(overrides: Partial<WorkerSpec> = {}): WorkerSpec {
  return {
    sessionId: 's1',
    cwd: '/tmp/worktree-alpha',
    mandate: 'team leader',
    // Audit inactif EXPLICITEMENT sur cette doublure (H-74) : jamais une omission.
    mcpServers: {}, portAuditPermissions: () => ({}),
    deniedToolPatterns: [],
    maxBudgetUsd: 25,
    ...overrides,
  };
}

describe('PersistanceRegistreSqlite', () => {
  test('sauvegarder puis tous() relit exactement ce qui a été écrit', () => {
    const persistance = new PersistanceRegistreSqlite({ chemin: ':memory:' });
    persistance.sauvegarder({
      sessionId: 's1',
      missionId: 'm1',
      worktree: '/tmp/worktree-alpha',
      epoch: 3,
      pid: 4242,
      pidStarttime: '987654',
      bootId: 'boot-abc',
      vivant: true,
      spec: specFactice(),
    });

    const lignes = persistance.tous();
    expect(lignes).toHaveLength(1);
    expect(lignes[0]).toMatchObject({
      sessionId: 's1',
      missionId: 'm1',
      worktree: '/tmp/worktree-alpha',
      epoch: 3,
      pid: 4242,
      pidStarttime: '987654',
      bootId: 'boot-abc',
      vivant: true,
    });
    // ☠ La spec relue N'EST PAS la spec écrite : les ports sont des fonctions, que
    // JSON.stringify efface sans rien signaler. C'est un fait de conception, pas un
    // détail de test — relancer un worker depuis cette spec sans réinjecter les ports
    // donnerait un worker sans audit ni arbitrage de permissions (H-74).
    //
    // `mcpServers` n'est pas non plus recopié tel quel (H-76) : `donneesSeules` en
    // porte encore la forme `Record<string, McpServerConfig>` (le type d'entrée),
    // la ligne relue en base porte la forme projetée `Record<string, McpServeurPersiste>`
    // — ici `{}` des deux côtés puisque `specFactice()` ne pose aucun serveur.
    const { portAuditPermissions, ...donneesSeules } = specFactice();
    expect(typeof portAuditPermissions).toBe('function');
    expect(lignes[0]?.spec).toEqual({ ...donneesSeules, mcpServers: {} });
    expect(lignes[0]?.spec).not.toHaveProperty('portAuditPermissions');
  });

  test('sauvegarder deux fois la même sessionId met à jour la ligne (ON CONFLICT), jamais de doublon', () => {
    const persistance = new PersistanceRegistreSqlite({ chemin: ':memory:' });
    persistance.sauvegarder({
      sessionId: 's1', missionId: 'm1', worktree: '/tmp/a', epoch: 1,
      pid: null, pidStarttime: null, bootId: 'boot-abc', vivant: true, spec: specFactice(),
    });
    persistance.sauvegarder({
      sessionId: 's1', missionId: 'm1', worktree: '/tmp/a', epoch: 2,
      pid: 100, pidStarttime: '1', bootId: 'boot-def', vivant: true, spec: specFactice(),
    });

    const lignes = persistance.tous();
    expect(lignes).toHaveLength(1);
    expect(lignes[0]?.epoch).toBe(2);
    expect(lignes[0]?.pid).toBe(100);
    // ☠ ON CONFLICT doit aussi mettre à jour boot_id — sinon un rattachement
    // après un vrai redémarrage laisserait l'ANCIEN boot_id en base (H-75).
    expect(lignes[0]?.bootId).toBe('boot-def');
  });

  test('marquerMort bascule vivant à false sans retirer la ligne', () => {
    const persistance = new PersistanceRegistreSqlite({ chemin: ':memory:' });
    persistance.sauvegarder({
      sessionId: 's1', missionId: 'm1', worktree: '/tmp/a', epoch: 1,
      pid: 100, pidStarttime: '1', bootId: 'boot-abc', vivant: true, spec: specFactice(),
    });
    persistance.marquerMort('s1');

    const lignes = persistance.tous();
    expect(lignes).toHaveLength(1);
    expect(lignes[0]?.vivant).toBe(false);
  });

  test('marquerMort sur une sessionId inconnue ne lève rien (pas de ligne à affecter)', () => {
    const persistance = new PersistanceRegistreSqlite({ chemin: ':memory:' });
    expect(() => persistance.marquerMort('inconnue')).not.toThrow();
    expect(persistance.tous()).toHaveLength(0);
  });

  test('pid et pidStarttime null sont persistés et relus tels quels (worker sans pid connu)', () => {
    const persistance = new PersistanceRegistreSqlite({ chemin: ':memory:' });
    persistance.sauvegarder({
      sessionId: 's1', missionId: 'm1', worktree: '/tmp/a', epoch: 1,
      pid: null, pidStarttime: null, bootId: 'boot-abc', vivant: true, spec: specFactice(),
    });
    const [ligne] = persistance.tous();
    expect(ligne?.pid).toBeNull();
    expect(ligne?.pidStarttime).toBeNull();
  });

  test('bootId null est persisté et relu tel quel (H-75 : ligne sans identité de boot connue)', () => {
    const persistance = new PersistanceRegistreSqlite({ chemin: ':memory:' });
    persistance.sauvegarder({
      sessionId: 's1', missionId: 'm1', worktree: '/tmp/a', epoch: 1,
      pid: 100, pidStarttime: '1', bootId: null, vivant: true, spec: specFactice(),
    });
    const [ligne] = persistance.tous();
    expect(ligne?.bootId).toBeNull();
  });

  test('H-76 : mcpServers portant une instance SDK à référence circulaire n\'empêche plus l\'écriture (panne du 18/08 20h19)', () => {
    // Reproduit la forme réelle de `McpSdkServerConfigWithInstance.instance`
    // (`creerServeurMcpDepense()` → `createSdkMcpServer()`) : un objet à
    // référence circulaire suffit à reproduire `TypeError: JSON.stringify
    // cannot serialize cyclic structures` — pas besoin du SDK complet.
    const instanceCyclique: Record<string, unknown> = { name: 'ccremote-depense' };
    instanceCyclique.self = instanceCyclique;

    const persistance = new PersistanceRegistreSqlite({ chemin: ':memory:' });
    persistance.sauvegarder({
      sessionId: 's1', missionId: 'm1', worktree: '/tmp/a', epoch: 1,
      pid: null, pidStarttime: null, bootId: 'boot-abc', vivant: true,
      spec: specFactice({
        mcpServers: {
          // `as unknown as ...` justifié : on simule volontairement la forme
          // NON sérialisable que rend `createSdkMcpServer()` en production,
          // que le type `McpServerConfig` normal exclut par construction.
          'ccremote-depense': { type: 'sdk', name: 'ccremote-depense', instance: instanceCyclique } as unknown as WorkerSpec['mcpServers'][string],
        },
      }),
    });

    // ☠ La preuve n'est pas « sauvegarder() n'a pas levé » (elle catch déjà
    // tout en interne) mais que la LIGNE est réellement en base — avant ce
    // correctif, sauvegarder() catchait la TypeError et n'écrivait rien : ce
    // test aurait vu `toHaveLength(0)`, silencieusement, comme en production.
    const lignes = persistance.tous();
    expect(lignes).toHaveLength(1);
    // Le nom du serveur survit (utile à la restauration), jamais l'instance.
    expect(lignes[0]?.spec.mcpServers).toEqual({ 'ccremote-depense': { type: 'sdk' } });
    persistance.fermer();
  });

  test('H-75 : une base écrite AVANT la colonne boot_id migre sans corrompre ni perdre de lignes', () => {
    const dossier = mkdtempSync(join(tmpdir(), 'ccremote-registre-migration-'));
    const chemin = join(dossier, 'registre.sqlite');

    // Simule le schéma version 1 (avant H-75) : pas de colonne boot_id, pas de
    // migration appliquée ni tracée — exactement ce qu'un fichier réel écrit
    // par l'ancien code contient déjà.
    const dbAncienne = new Database(chemin, { create: true });
    dbAncienne.run(`
      CREATE TABLE worker_registre (
        session_id     TEXT PRIMARY KEY,
        mission_id     TEXT NOT NULL,
        worktree       TEXT NOT NULL,
        epoch          INTEGER NOT NULL,
        pid            INTEGER,
        pid_starttime  TEXT,
        vivant         INTEGER NOT NULL CHECK (vivant IN (0, 1)),
        spec_json      TEXT NOT NULL,
        maj_a          INTEGER NOT NULL
      ) STRICT;
    `);
    dbAncienne.run('PRAGMA user_version = 1');
    dbAncienne
      .query(
        `INSERT INTO worker_registre
           (session_id, mission_id, worktree, epoch, pid, pid_starttime, vivant, spec_json, maj_a)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run('s-pre-migration', 'm-pre-migration', '/tmp/pre-migration', 1, 4242, '987654', 1, '{}', 1000);
    dbAncienne.close(false);

    // Rouvre avec le code ACTUEL : la migration doit s'appliquer sans perdre la ligne.
    const persistance = new PersistanceRegistreSqlite({ chemin });
    const lignes = persistance.tous();

    expect(lignes).toHaveLength(1);
    expect(lignes[0]).toMatchObject({
      sessionId: 's-pre-migration',
      missionId: 'm-pre-migration',
      worktree: '/tmp/pre-migration',
      epoch: 1,
      pid: 4242,
      pidStarttime: '987654',
      vivant: true,
    });
    // ☠ Le point critique de H-75 : boot_id ABSENT sur une ligne pré-migration
    // doit rester lisible comme `null`, jamais provoquer d'erreur ni de valeur
    // par défaut trompeuse (ex. chaîne vide confondue avec un vrai boot_id).
    expect(lignes[0]?.bootId).toBeNull();

    // Une nouvelle écriture après migration porte bien boot_id.
    persistance.sauvegarder({
      sessionId: 's-post-migration', missionId: 'm-post-migration', worktree: '/tmp/post-migration',
      epoch: 1, pid: null, pidStarttime: null, bootId: 'boot-nouveau', vivant: true, spec: specFactice(),
    });
    const ligneNouvelle = persistance.tous().find((l) => l.sessionId === 's-post-migration');
    expect(ligneNouvelle?.bootId).toBe('boot-nouveau');

    persistance.fermer();
  });
});
