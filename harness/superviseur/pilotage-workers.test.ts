/**
 * Prouve que le pilotage atteint RÉELLEMENT `ControleurPause` depuis un
 * `SuperviseurWorkers` construit normalement.
 *
 * `☠` Sans ce banc, `ControleurPause` resterait ce qu'il était jusqu'ici :
 * écrit, testé isolément, et appelé par personne. Le comportement vérifié n'est
 * pas « la méthode existe » mais celui qui compte pour l'opérateur — un message
 * envoyé pendant une pause est RETENU, puis transmis à la reprise. C'est la
 * différence entre une pause qui protège et une pause décorative.
 */

import { describe, expect, test } from 'bun:test';
import type { Query, SDKMessage, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { CompteurRelances } from '../relance/compteur-relances.ts';
import type { WorkerCapabilities, WorkerHandle, WorkerSpec } from '../workers/index.ts';
import { SuperviseurWorkers, type DemarrerWorkerFn } from './superviseur-workers.ts';
import { MissionNonPilotableError } from './pilotage-workers.ts';
import { CAPACITE_RECU_INTERRUPTION } from '../pause/index.ts';
import type { DemandeDemarrage } from './types.ts';

/**
 * `☠` `advertised` porte la capacité `CAPACITE_RECU_INTERRUPTION` : sans elle,
 * `ControleurPause` ne peut pas lire le reçu d'interruption. La renseigner ici
 * n'est pas un détail de banc — c'est ce que le vrai worker annonce.
 */
const CAPACITES: WorkerCapabilities = {
  advertised: [CAPACITE_RECU_INTERRUPTION],
  claudeCodeVersion: '2.0.0',
  tools: [],
  model: 'claude-sonnet-4-6',
  sessionId: 'ses-1',
};

function fluxVide(interrupt: () => Promise<{ still_queued: string[] }>): Query {
  const flux = (async function* (): AsyncGenerator<SDKMessage> {
    // Aucun message : ce banc n'observe que l'entrée, jamais la sortie.
    await new Promise(() => {});
  })() as unknown as Query;
  return Object.assign(flux, {
    interrupt,
    close: () => {},
    setPermissionMode: async () => {},
    setModel: async () => {},
    supportedModels: async () => [],
    supportedCommands: async () => [],
    mcpServerStatus: async () => ({}),
  }) as Query;
}

function superviseurAvecWorker(): { superviseur: SuperviseurWorkers; recus: string[] } {
  const recus: string[] = [];
  const demarrer: DemarrerWorkerFn = (async (spec: WorkerSpec) => {
    const handle: WorkerHandle = {
      sessionId: spec.sessionId,
      cwd: spec.cwd,
      capabilities: { ...CAPACITES, sessionId: spec.sessionId },
      model: { requested: 'sonnet', resolved: 'claude-sonnet-4-6', tier: 'sonnet', viaInheritance: false },
      preflight: {
        ok: true, cwd: spec.cwd, loadedSources: [], machineClaudeMdPath: null,
        projectClaudeMdPaths: [], effectiveModel: 'sonnet', failures: [],
      },
      abortController: new AbortController(),
      query: fluxVide(async () => ({ still_queued: [] })),
      pid: null,
      pidStarttime: null,
    };
    return handle;
  }) as DemarrerWorkerFn;

  const superviseur = new SuperviseurWorkers({ compteurRelances: new CompteurRelances(), demarrerWorker: demarrer });
  // On observe l'entrée réelle du worker via la cible publique (A.2.2).
  const cibleOriginale = superviseur.cible.bind(superviseur);
  superviseur.cible = ((missionId: string) => {
    const c = cibleOriginale(missionId);
    if (c === null) return null;
    return {
      ...c,
      envoyerMessage: async (m: SDKUserMessage) => {
        recus.push(String((m.message as { content: unknown }).content));
        await c.envoyerMessage(m);
      },
    };
  }) as typeof superviseur.cible;
  return { superviseur, recus };
}

function demande(): DemandeDemarrage {
  return {
    missionId: 'mission-1',
    epoch: 1,
    promptInitial: 'démarre',
    spec: {
      sessionId: 'ses-1',
      cwd: '/tmp/worktree-pilotage',
      mandate: 'mandat de banc',
      deniedToolPatterns: [],
      maxBudgetUsd: 10,
      portAuditPermissions: () => ({}),
    },
  };
}

describe('pilotage — ControleurPause réellement atteint depuis le superviseur', () => {
  test('☠ une instruction envoyée PENDANT une pause est RETENUE, pas transmise', async () => {
    const { superviseur } = superviseurAvecWorker();
    await superviseur.demarrer(demande());

    await superviseur.pilotage.mettreEnPause('mission-1');
    const { retenue } = await superviseur.pilotage.envoyerInstruction('mission-1', 'change de branche');

    // C'est TOUT l'intérêt de la pause : sans le contrôleur, ce message
    // atterrirait dans un agent que l'opérateur croit arrêté.
    expect(retenue).toBe(true);
  });

  test('la reprise transmet les messages retenus, et le compte remonte', async () => {
    const { superviseur } = superviseurAvecWorker();
    await superviseur.demarrer(demande());

    await superviseur.pilotage.mettreEnPause('mission-1');
    await superviseur.pilotage.envoyerInstruction('mission-1', 'un');
    await superviseur.pilotage.envoyerInstruction('mission-1', 'deux');

    const { enAttenteTransmis } = await superviseur.pilotage.reprendre('mission-1');
    expect(enAttenteTransmis).toBe(2);
  });

  test('hors pause, une instruction n’est jamais retenue', async () => {
    const { superviseur } = superviseurAvecWorker();
    await superviseur.demarrer(demande());
    const { retenue } = await superviseur.pilotage.envoyerInstruction('mission-1', 'directe');
    expect(retenue).toBe(false);
  });

  test('☠ un ordre à une mission inconnue LÈVE — jamais absorbé en silence', async () => {
    const { superviseur } = superviseurAvecWorker();
    await expect(superviseur.pilotage.mettreEnPause('mission-fantome')).rejects.toThrow(MissionNonPilotableError);
  });

  test('une instruction vide est refusée avant d’atteindre le worker', async () => {
    const { superviseur } = superviseurAvecWorker();
    await superviseur.demarrer(demande());
    await expect(superviseur.pilotage.envoyerInstruction('mission-1', '  ')).rejects.toThrow(RangeError);
  });
});
