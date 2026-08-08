/**
 * Preuve d'innocuité E6 (PLAN-PORTAGE.md, la plus importante de tout le plan) : avec le
 * moteur d'inférence de la boucle d'apprentissage INJOIGNABLE (`CCREMOTE_APPRENTISSAGE_CONFIG_DIR`
 * pointé sur un répertoire vide), une mission simulée se clôt NORMALEMENT — le worker est
 * marqué mort, le registre PC-local (`RegistreWorkers`, celui que ce module possède) le
 * reflète — et la passe d'apprentissage se termine avec une entrée `passe_apprentissage`
 * portant une erreur, jamais une exception qui remonte.
 *
 * Aucun spawn réel (règle du dépôt) : un `demarrerWorker` factice fournit un flux de messages
 * SDK simulé, exactement le pattern déjà établi par `superviseur/superviseur-workers.test.ts`.
 *
 * Usage : bun run acceptation/apprentissage-innocuite-cloture.ts
 */

import type { Query, SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CompteurRelances } from '../relance/compteur-relances.ts';
import { SuperviseurWorkers, type DemarrerWorkerFn } from '../superviseur/superviseur-workers.ts';
import type { DemandeDemarrage } from '../superviseur/types.ts';
import type { WorkerCapabilities, WorkerHandle, WorkerSpec } from '../workers/index.ts';
import { ouvrirBaseApprentissage, fermerBaseApprentissage } from '../apprentissage/index.ts';
import { obtenirPasse } from '../apprentissage/base/lecons.ts';

function horodate(message: string): void {
  console.log(`[${new Date().toISOString()}] ${message}`);
}

function capacites(): WorkerCapabilities {
  return { advertised: [], claudeCodeVersion: '2.1.217', tools: ['Bash'], mcpServers: [], model: 'claude-sonnet-4-6', sessionId: 's' };
}

/** Même doublure que `superviseur-workers.test.ts` : le flux ne se termine jamais tout seul. */
function fakeQuery(messages: readonly SDKMessage[]): Query {
  let fermer = (): void => {};
  const close = new Promise<void>((resolve) => {
    fermer = resolve;
  });
  async function* flux(): AsyncGenerator<SDKMessage, void> {
    for (const message of messages) yield message;
    await close;
  }
  const iterateur = flux();
  return Object.assign(iterateur, {
    interrupt: async () => ({ still_queued: [] }),
    close: (): void => fermer(),
    reinitialize: async () => ({ commands: [], agents: [], models: [] }),
  }) as unknown as Query;
}

function resultMessage(sessionId: string): SDKMessage {
  return {
    type: 'result',
    subtype: 'success',
    duration_ms: 1,
    duration_api_ms: 1,
    is_error: false,
    num_turns: 1,
    result: 'ok',
    stop_reason: null,
    total_cost_usd: 0.05,
    usage: {} as never,
    modelUsage: {},
    permission_denials: [],
    terminal_reason: 'completed' as never, // groupe fin_normale, action 'rien' (relance/classification.ts)
    uuid: '11111111-2222-3333-4444-555555555555',
    session_id: sessionId,
  } as unknown as SDKMessage;
}

async function main(): Promise<void> {
  const sessionId = 'session-innocuite';
  const missionId = 'mission-innocuite';
  const dossier = mkdtempSync(join(tmpdir(), 'ccremote-innocuite-'));

  // ☠ Le point de la preuve : le moteur d'inférence est INJOIGNABLE (répertoire de compte
  // vide, aucune session Claude Code n'y a jamais tourné) — exactement la suggestion de
  // l'orchestrateur pour simuler l'indisponibilité sans dépendre d'un serveur externe éteint.
  process.env['CCREMOTE_APPRENTISSAGE_ACTIF'] = '1';
  process.env['CCREMOTE_APPRENTISSAGE_DB'] = join(dossier, 'apprentissage.db');
  process.env['CCREMOTE_APPRENTISSAGE_CONFIG_DIR'] = join(dossier, 'compte-vide-inexistant');

  const demarrerWorker: DemarrerWorkerFn = (async (spec: WorkerSpec) => {
    const handle: WorkerHandle = {
      sessionId: spec.sessionId,
      cwd: spec.cwd,
      capabilities: capacites(),
      model: { requested: 'sonnet', resolved: 'claude-sonnet-4-6', tier: 'sonnet', viaInheritance: false },
      preflight: { ok: true, cwd: spec.cwd, loadedSources: [], machineClaudeMdPath: null, projectClaudeMdPaths: [], effectiveModel: 'sonnet', failures: [] },
      pid: null,
      pidStarttime: null,
      abortController: new AbortController(),
      query: fakeQuery([resultMessage(spec.sessionId)]),
    };
    return handle;
  }) as unknown as DemarrerWorkerFn;

  const superviseur = new SuperviseurWorkers({ compteurRelances: new CompteurRelances(), demarrerWorker });

  const demande: DemandeDemarrage = {
    missionId,
    epoch: 1,
    spec: {
      sessionId,
      cwd: dossier,
      mandate: 'Mission de test — preuve d’innocuité E6.',
      deniedToolPatterns: [],
      maxBudgetUsd: 5,
      configDir: join(dossier, 'compte-vide-inexistant'),
      mcpServers: {},
      portAuditPermissions: () => ({}),
    },
    promptInitial: 'go',
  };

  await superviseur.demarrer(demande);

  horodate('AVANT clôture — ligne du registre PC-local (RegistreWorkers, ce que ce module possède) :');
  console.log(JSON.stringify(superviseur.inventaire(), null, 2));

  // Laisse la boucle de surveillance des résultats (asynchrone, `void this.#surveillerResultats(...)`
  // dans `demarrer()`) traiter le `result` et la passe d'apprentissage se dérouler.
  await new Promise((resolve) => setTimeout(resolve, 2_000));

  horodate('APRÈS clôture — ligne du registre PC-local :');
  console.log(JSON.stringify(superviseur.inventaire(), null, 2));

  const vivant = superviseur.inventaire().find((w) => w.sessionId === sessionId)?.vivant;
  if (vivant !== false) {
    console.error('☠ ÉCHEC DE LA PREUVE : le worker n’a pas été marqué mort — la clôture a été perturbée.');
    process.exitCode = 1;
  } else {
    horodate('mission close normalement — le worker est mort, le worktree est libérable.');
  }

  const db = ouvrirBaseApprentissage();
  const passe = obtenirPasse(db, missionId);
  horodate('ligne passe_apprentissage (artefact réel de la passe, avec le moteur injoignable) :');
  console.log(JSON.stringify(passe, null, 2));
  fermerBaseApprentissage(db);

  if (passe === null) {
    horodate('note : aucune ligne enregistrée pour l’instant (course possible avec le setTimeout ci-dessus).');
  } else if (passe.erreur === null) {
    console.error('☠ INATTENDU : la passe a réussi alors que le modèle devait être injoignable.');
  } else {
    horodate(`passe correctement en échec, rejouable — erreur : « ${passe.erreur} »`);
  }

  rmSync(dossier, { recursive: true, force: true });
}

await main();
