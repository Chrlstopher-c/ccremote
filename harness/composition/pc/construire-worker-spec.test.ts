/**
 * `construireWorkerSpec` est LE point unique où un `WorkerSpec` de production
 * est assemblé sur une machine de travail. Ce qui s'y perd ne se rattrape nulle
 * part — d'où ces tests.
 */

import { describe, expect, test } from 'bun:test';
import { construireWorkerSpec } from './construire-worker-spec.ts';
import type { PortAuditPermissions } from '../../workers/types.ts';

// ---------------------------------------------- H-44 : le poste possède sa config

describe('répertoire de compte — H-44 rendue effective (multi-machines, 01/08)', () => {
  const base = {
    sessionId: 's-1',
    cwd: '/mnt/projects/stockiop',
    mandate: 'm',
    deniedToolPatterns: [],
    maxBudgetUsd: 5,
  };
  const port: PortAuditPermissions = {} as PortAuditPermissions;

  test('☠ le chemin du Pi est REMPLACÉ par celui de cette machine', () => {
    // `☠ MESURÉ EN PRODUCTION LE 01/08.` Le Pi ne tient qu'UNE liste de comptes
    // (`CCREMOTE_PI_COMPTES`, les chemins du PC). Routé vers le VPS, un mandat
    // portait donc `/home/trinity/.claude-comptes/compte-a` — inexistant là-bas.
    // Le pré-vol refusait de spawner : bruyant, mais le VPS était structurellement
    // incapable de lancer une équipe. Seule l'IDENTITÉ du compte traverse ; le
    // chemin appartient à la machine.
    const spec = construireWorkerSpec(
      { ...base, compteId: 'compte-a', configDir: '/home/trinity/.claude-comptes/compte-a' },
      port,
      [{ id: 'compte-a', configDir: '/home/ubuntu/.claude-comptes/compte-a' }],
    );
    expect(spec.configDir).toBe('/home/ubuntu/.claude-comptes/compte-a');
  });

  test('compte inconnu d’ici ⇒ le chemin du Pi est conservé, jamais inventé', () => {
    const spec = construireWorkerSpec(
      { ...base, compteId: 'compte-z', configDir: '/home/trinity/.claude-comptes/compte-z' },
      port,
      [{ id: 'compte-a', configDir: '/home/ubuntu/.claude-comptes/compte-a' }],
    );
    expect(spec.configDir).toBe('/home/trinity/.claude-comptes/compte-z');
  });

  test('aucun compte local déclaré ⇒ comportement d’origine intact (mono-machine)', () => {
    const spec = construireWorkerSpec({ ...base, configDir: '/home/trinity/.claude-comptes/compte-a' }, port);
    expect(spec.configDir).toBe('/home/trinity/.claude-comptes/compte-a');
  });
});
