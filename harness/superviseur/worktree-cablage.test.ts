/**
 * Câblage E2 (mandat câblage-worktree) : `SuperviseurWorkers.demarrer()`/`arreter()`
 * appellent réellement `GestionnaireCycleVieWorktree.allouer()`/`liberer()` — jusqu'à
 * cette mission, le module `projets/cycle-vie-worktree.ts` était testé et jamais
 * atteint par un chemin de production (banc `acceptation/worktree-git-reel.ts` mis
 * à part).
 *
 * `☠` Git RÉEL, comme `acceptation/worktree-git-reel.ts` : `InterrogateurGitReel`/
 * `GestionnaireWorktreeGitReel` shell-outent vers `git`, et la preuve qui compte ici
 * — « le `mkdirSync` du piège ne recrée jamais ce que `git worktree add` a déjà créé »
 * — n'est vérifiable qu'avec un vrai worktree (présence du fichier `.git`, que
 * `mkdirSync` seul ne produit jamais).
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Query, SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { CompteurRelances } from '../relance/compteur-relances.ts';
import { GestionnaireCycleVieWorktree, GestionnaireWorktreeGitReel, InterrogateurGitReel } from '../projets/index.ts';
import { SuperviseurWorkers, type DemarrerWorkerFn } from './superviseur-workers.ts';
import type { DemandeDemarrage } from './types.ts';
import type { WorkerCapabilities, WorkerHandle, WorkerSpec } from '../workers/index.ts';

let racine: string;
let depot: string;
let racineWorktrees: string;

/**
 * Double minimal de `Query`. `☠` Le flux NE SE TERMINE PAS tant que `close()`
 * n'est pas appelé — même piège que `superviseur-workers.test.ts` : un flux qui
 * s'épuise tout seul fait croire à `#surveillerResultats` que le worker est déjà
 * mort, et `arreter()` retournerait alors AVANT d'atteindre la libération du
 * worktree (`vivant` faussement `false`) — pas une panne de production, mais un
 * faux négatif de ce banc s'il était omis.
 */
function queryFactice(): Query {
  let fermer = (): void => {};
  const close = new Promise<void>((resolve) => {
    fermer = resolve;
  });
  async function* flux(): AsyncGenerator<SDKMessage, void> {
    await close;
  }
  return Object.assign(flux(), {
    interrupt: async () => ({ still_queued: [] }),
    close: (): void => fermer(),
    reinitialize: async () => ({ commands: [], agents: [], models: [] }),
  }) as unknown as Query;
}

const demarrerWorkerFactice: DemarrerWorkerFn = (async (workerSpec: WorkerSpec) => {
  const capacites: WorkerCapabilities = {
    advertised: [],
    claudeCodeVersion: '2.1.217',
    tools: [],
    mcpServers: [],
    model: 'claude-sonnet-4-6',
    sessionId: workerSpec.sessionId,
  };
  const handle: WorkerHandle = {
    sessionId: workerSpec.sessionId,
    cwd: workerSpec.cwd,
    capabilities: capacites,
    model: { requested: 'sonnet', resolved: 'claude-sonnet-4-6', tier: 'sonnet', viaInheritance: false },
    preflight: {
      ok: true,
      cwd: workerSpec.cwd,
      loadedSources: ['user', 'project', 'local'],
      machineClaudeMdPath: null,
      projectClaudeMdPaths: [],
      effectiveModel: 'sonnet',
      failures: [],
    },
    pid: null,
    pidStarttime: null,
    abortController: new AbortController(),
    query: queryFactice(),
  };
  return handle;
}) as unknown as DemarrerWorkerFn;

function demande(missionId: string, cwd: string, epoch = 1): DemandeDemarrage {
  return {
    missionId,
    epoch,
    promptInitial: 'bonjour',
    spec: { sessionId: `sess-${missionId}`, cwd, mandate: 'test', deniedToolPatterns: [] } as unknown as WorkerSpec,
  };
}

function superviseurAvecGestionnaire(): SuperviseurWorkers {
  const gestionnaireWorktrees = new GestionnaireCycleVieWorktree({
    interrogateur: new InterrogateurGitReel(),
    gestionnaire: new GestionnaireWorktreeGitReel(),
  });
  return new SuperviseurWorkers({
    compteurRelances: new CompteurRelances(),
    racineProjets: racine,
    demarrerWorker: demarrerWorkerFactice,
    gestionnaireWorktrees,
    racineWorktrees,
  } as never);
}

async function depotGitJetable(): Promise<string> {
  const chemin = join(racine, 'depot-git');
  await Bun.$`mkdir -p ${chemin}`.quiet();
  await Bun.$`git -C ${chemin} init -q -b main`.quiet();
  await Bun.$`git -C ${chemin} config user.email banc@local`.quiet();
  await Bun.$`git -C ${chemin} config user.name Banc`.quiet();
  await Bun.write(`${chemin}/README.md`, '# dépôt jetable\n');
  await Bun.$`git -C ${chemin} add -A`.quiet();
  await Bun.$`git -C ${chemin} commit -q -m init`.quiet();
  return chemin;
}

beforeEach(async () => {
  racine = mkdtempSync(join(tmpdir(), 'worktree-cablage-'));
  racineWorktrees = join(racine, '.worktrees');
  depot = await depotGitJetable();
});

afterEach(() => rmSync(racine, { recursive: true, force: true }));

describe('demarrer() alloue un worktree git dédié (E2)', () => {
  test('le cwd effectif du worker est le worktree ALLOUÉ, distinct du dépôt principal', async () => {
    const sup = superviseurAvecGestionnaire();
    const handle = await sup.demarrer(demande('m-1', depot));

    expect(handle.cwd).not.toBe(depot);
    expect(handle.cwd.startsWith(racineWorktrees)).toBe(true);
  });

  test('☠ le worktree est un VRAI worktree git (fichier `.git`), pas un simple mkdirSync', async () => {
    const sup = superviseurAvecGestionnaire();
    const handle = await sup.demarrer(demande('m-2', depot));

    // `mkdirSync` seul ne produit jamais ce fichier — seule `git worktree add` le fait.
    // C'est la preuve mécanique que le piège (mkdirSync créant un répertoire VIDE là où
    // `git worktree add` doit opérer) est réconcilié : le chemin git a joué EN PREMIER.
    expect(existsSync(join(handle.cwd, '.git'))).toBe(true);
    expect(existsSync(join(handle.cwd, 'README.md'))).toBe(true);
  });

  test('worktreeDe(missionId) rend le chemin et la branche dédiée `equipe/<idEquipe>`', async () => {
    const sup = superviseurAvecGestionnaire();
    const handle = await sup.demarrer(demande('m-3', depot));

    expect(sup.worktreeDe('m-3')).toEqual({ chemin: handle.cwd, branche: 'equipe/m-3' });
  });

  test('deux missions sur le MÊME dépôt reçoivent deux worktrees DISTINCTS', async () => {
    const sup = superviseurAvecGestionnaire();
    const a = await sup.demarrer(demande('m-a', depot));
    const b = await sup.demarrer(demande('m-b', depot));

    expect(a.cwd).not.toBe(b.cwd);
    expect(existsSync(a.cwd)).toBe(true);
    expect(existsSync(b.cwd)).toBe(true);
  });
});

describe('demarrer() sans gestionnaire configuré : mode dégradé préservé', () => {
  test('sans `gestionnaireWorktrees`, le cwd reste celui fourni par le Pi (comportement historique)', async () => {
    const sup = new SuperviseurWorkers({
      compteurRelances: new CompteurRelances(),
      racineProjets: racine,
      demarrerWorker: demarrerWorkerFactice,
    } as never);
    const handle = await sup.demarrer(demande('m-degrade', depot));

    expect(handle.cwd).toBe(depot);
  });
});

describe('arreter() libère le worktree en fin de mission (E2)', () => {
  test('worktree PROPRE ⇒ réellement supprimé du disque', async () => {
    const sup = superviseurAvecGestionnaire();
    const handle = await sup.demarrer(demande('m-clean', depot));
    expect(existsSync(handle.cwd)).toBe(true);

    await sup.arreter('m-clean');

    expect(existsSync(handle.cwd)).toBe(false);
  });

  test('☠ dans l’AUTRE sens : worktree SALE (travail non commité) ⇒ CONSERVÉ, jamais perdu', async () => {
    const sup = superviseurAvecGestionnaire();
    const handle = await sup.demarrer(demande('m-sale', depot));
    await Bun.write(join(handle.cwd, 'travail-precieux.txt'), 'ne doit pas disparaître\n');

    await sup.arreter('m-sale');

    // Même garde que le cas propre au-dessus, signal opposé : la preuve que la
    // suppression est bien CONDITIONNELLE, pas systématique.
    expect(existsSync(handle.cwd)).toBe(true);
    expect(existsSync(join(handle.cwd, 'travail-precieux.txt'))).toBe(true);
  });

  test('arreter() une seconde fois (déjà mort) ne lève pas — idempotence préservée', async () => {
    const sup = superviseurAvecGestionnaire();
    await sup.demarrer(demande('m-double', depot));
    await sup.arreter('m-double');

    await expect(sup.arreter('m-double')).resolves.toBeUndefined();
  });
});
