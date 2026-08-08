/**
 * Preuve du déclenchement périodique de la consolidation (E10, le fil qui ne pendait plus
 * après le câblage dans `superviseur-workers.ts`) :
 *
 *   1. REFUS — une mission active sur la machine (registre PC-local, `RegistreWorkers`) fait
 *      refuser le tick même avec une horloge « semée » à plus de 7 jours dans le passé.
 *   2. DÉCLENCHEMENT RÉEL — la mission se clôt normalement (le worker est marqué mort, comme
 *      TOUJOURS), le registre le reflète, et le tick suivant exécute une VRAIE passe :
 *      rapport Markdown réel sur disque, horloge de consolidation avancée.
 *
 * Même doublure de flux SDK que `apprentissage-innocuite-cloture.ts` (aucun spawn réel, règle
 * du dépôt). Le planificateur est CAPTURÉ (jamais auto-exécuté) : un `planifier` synchrone
 * boucherait sur la reprogrammation récursive du tick — ce script pilote chaque tick à la main.
 *
 * Usage : bun run acceptation/apprentissage-consolidation-periodique-reel.ts
 */

import type { Query, SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CompteurRelances } from '../relance/compteur-relances.ts';
import { SuperviseurWorkers, type DemarrerWorkerFn } from '../superviseur/superviseur-workers.ts';
import type { DemandeDemarrage } from '../superviseur/types.ts';
import type { WorkerCapabilities, WorkerHandle, WorkerSpec } from '../workers/index.ts';
import { ouvrirBaseApprentissage, fermerBaseApprentissage } from '../apprentissage/index.ts';
import { enregistrerDernierePasseA, obtenirDernierePasseA } from '../apprentissage/base/horloge-consolidation.ts';
import { INTERVALLE_MIN_MS } from '../apprentissage/service/consolidation.ts';

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
  const sessionId = 'session-consolidation-periodique';
  const missionId = 'mission-consolidation-periodique';
  const dossier = mkdtempSync(join(tmpdir(), 'ccremote-consolidation-periodique-'));
  const racineApprentissage = join(dossier, 'apprentissage');

  process.env['CCREMOTE_APPRENTISSAGE_ACTIF'] = '1';
  process.env['CCREMOTE_APPRENTISSAGE_DIR'] = racineApprentissage;
  process.env['CCREMOTE_APPRENTISSAGE_DB'] = join(racineApprentissage, 'apprentissage.db');
  process.env['CCREMOTE_APPRENTISSAGE_COMPETENCES_DIR'] = join(racineApprentissage, 'competences');

  // Horloge « semée » à plus de 7 jours dans le passé — porte horloge déjà ouverte AVANT même
  // de construire le superviseur, exactement comme `executerConsolidation` sème réellement une
  // base neuve à la première observation (mais ici on force le cas « déjà observée, il y a longtemps »).
  const seed = ouvrirBaseApprentissage();
  const avant = Date.now() - INTERVALLE_MIN_MS - 24 * 60 * 60 * 1000; // 8 jours dans le passé
  enregistrerDernierePasseA(seed, avant);
  fermerBaseApprentissage(seed);
  horodate(`horloge de consolidation SEMÉE avant construction : ${new Date(avant).toISOString()}`);

  let dernierTache: (() => void) | null = null;
  const planifier = (_delaiMs: number, tache: () => void): void => {
    dernierTache = tache;
  };

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

  const superviseur = new SuperviseurWorkers({ compteurRelances: new CompteurRelances(), demarrerWorker, planifier });

  if (dernierTache === null) {
    console.error('☠ ÉCHEC DE LA PREUVE : aucun tick n’a été programmé à la construction — le câblage E10 est absent.');
    process.exitCode = 1;
    return;
  }
  horodate('tick de consolidation programmé dès la construction du superviseur (E10).');

  const demande: DemandeDemarrage = {
    missionId,
    epoch: 1,
    spec: {
      sessionId,
      cwd: dossier,
      mandate: 'Mission de test — preuve de déclenchement périodique E10.',
      deniedToolPatterns: [],
      maxBudgetUsd: 5,
      configDir: join(dossier, 'compte-vide-inexistant'),
      mcpServers: {},
      portAuditPermissions: () => ({}),
    },
    promptInitial: 'go',
  };

  await superviseur.demarrer(demande);
  horodate('mission démarrée — ligne du registre PC-local AVANT clôture :');
  console.log(JSON.stringify(superviseur.inventaire(), null, 2));

  // --- PREUVE 1 : REFUS avec une mission active, quelle que soit l'horloge ---
  horodate('déclenchement manuel du tick — mission ENCORE active :');
  (dernierTache as () => void)();

  const dbRefus = ouvrirBaseApprentissage();
  const horlogeApresRefus = obtenirDernierePasseA(dbRefus);
  fermerBaseApprentissage(dbRefus);
  horodate(`horloge de consolidation après le tick refusé : ${new Date(horlogeApresRefus!).toISOString()} (inchangée = refus prouvé)`);
  if (horlogeApresRefus !== avant) {
    console.error('☠ ÉCHEC DE LA PREUVE : l’horloge a bougé alors qu’une mission était active — la porte n’a pas refusé.');
    process.exitCode = 1;
  }

  // Laisse la boucle de surveillance des résultats traiter le `result` (fin normale, pas de
  // relance) : le worker est marqué mort, le registre PC-local le reflète.
  await new Promise((resolve) => setTimeout(resolve, 1_000));
  horodate('mission close normalement — ligne du registre PC-local APRÈS clôture :');
  console.log(JSON.stringify(superviseur.inventaire(), null, 2));

  // --- PREUVE 2 : DÉCLENCHEMENT RÉEL une fois la mission close ---
  horodate('déclenchement manuel du tick suivant — aucune mission active :');
  (dernierTache as () => void)();

  const dbApres = ouvrirBaseApprentissage();
  const horlogeApres = obtenirDernierePasseA(dbApres);
  fermerBaseApprentissage(dbApres);
  horodate(`horloge de consolidation après le tick exécuté : ${new Date(horlogeApres!).toISOString()}`);

  const racineRapports = join(racineApprentissage, 'rapports');
  const rapports = readdirSync(racineRapports);
  if (rapports.length === 0) {
    console.error('☠ ÉCHEC DE LA PREUVE : aucun rapport écrit alors que la porte aurait dû s’ouvrir.');
    process.exitCode = 1;
  } else {
    const rapport = readFileSync(join(racineRapports, rapports[0]!), 'utf8');
    horodate('rapport de passe RÉEL, déclenché automatiquement par le tick périodique (E10) :');
    console.log(rapport);
  }

  rmSync(dossier, { recursive: true, force: true });
}

await main();
