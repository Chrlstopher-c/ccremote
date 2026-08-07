/**
 * Test d'ASSEMBLAGE du bloc en cours de frappe (E.2) — de bout en bout, du
 * point réellement invoqué à celui réellement lu.
 *
 * La chaîne exercée, sans aucune doublure des couches testées :
 *   `SuperviseurWorkers` (unique lecteur du `Query`) → `RegistreObservationParc`
 *   → `CanalControle` (opération `partiel_flux`) → lien WebSocket Pi↔PC réel
 *   → `ClientSuperviseurPc` → `EtatPartielsMissions` (Pi, en mémoire)
 *   → `Bun.serve` de l'API du harness → `GET /missions/:id` → `partial`.
 *
 * `☠` POURQUOI PARTIR D'AUSSI LOIN — `RegistreObservationParc` était le douzième
 * « écrit, testé, branché sur rien » du dépôt : son test unitaire passait, et
 * aucun exécutable ne l'instanciait. Un test qui n'aurait couvert que le milieu
 * de la chaîne (le registre, ou le canal, ou la route) serait resté vert avec
 * exactement le défaut qu'on corrige.
 *
 * Ce que ce banc NE prouve pas : ni le réseau réel (`Bun.serve({ websocket })`,
 * Cloudflare), ni qu'un vrai lead émet des `stream_event` en production — ce
 * dernier point appartient à la validation du parent, sur une vraie équipe.
 */

import { afterEach, describe, expect, test } from 'bun:test';
import type { Query, SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { demarrerServeurApiWeb, type ServeurApiWeb } from '../control-plane/api-web/index.ts';
import { EtatPartielsMissions, RegistreObservationParc } from '../control-plane/observabilite/index.ts';
import { ouvrirRegistre, type Registre } from '../control-plane/registre/index.ts';
import { CompteurRelances } from '../relance/compteur-relances.ts';
import { SuperviseurWorkers, TAILLE_MAX_PARTIEL_FLUX } from '../superviseur/index.ts';
import type { DemandeDemarrage } from '../superviseur/types.ts';
import { LienWebSocket, type WebSocketLike } from '../transport/lien-websocket.ts';
import type { WorkerCapabilities, WorkerHandle, WorkerSpec } from '../workers/index.ts';
import { cablerRecepteurControlePc } from './pc/canal-controle-recepteur.ts';
import { ClientSuperviseurPc } from './pi/client-superviseur-pc.ts';
import { ParcSuperviseurs } from './pi/parc-superviseurs.ts';

const MISSION_ID = 'm-partiel-1';
const SESSION_ID = '11111111-2222-3333-4444-555555555555';

type Ecouteur<T> = (ev: T) => void;

/** Cross-branché à un pair — même minimalisme que `assemblage-lien-pc-pi.test.ts`. */
class FauxSocketApparie implements WebSocketLike {
  readyState = 1;
  pair: FauxSocketApparie | null = null;
  readonly #message: Ecouteur<{ data: unknown }>[] = [];
  readonly #close: Ecouteur<{ code: number; reason: string }>[] = [];

  send(data: Uint8Array): void {
    const pair = this.pair;
    if (pair === null) return;
    queueMicrotask(() => pair.#recevoir(data));
  }

  #recevoir(data: Uint8Array): void {
    for (const l of this.#message) l({ data });
  }

  close(code = 1000, reason = ''): void {
    this.readyState = 3;
    for (const l of this.#close) l({ code, reason });
  }

  addEventListener(
    type: 'message' | 'close' | 'error',
    listener: Ecouteur<{ data: unknown }> | Ecouteur<{ code: number; reason: string }> | Ecouteur<unknown>,
  ): void {
    if (type === 'message') this.#message.push(listener as Ecouteur<{ data: unknown }>);
    else if (type === 'close') this.#close.push(listener as Ecouteur<{ code: number; reason: string }>);
  }
}

function creerPaireLiens(): { pi: LienWebSocket; pc: LienWebSocket } {
  const socketPi = new FauxSocketApparie();
  const socketPc = new FauxSocketApparie();
  socketPi.pair = socketPc;
  socketPc.pair = socketPi;
  return {
    pi: new LienWebSocket({ connecter: () => Promise.resolve(socketPi), modeIntegrite: 'perte_silencieuse' }),
    pc: new LienWebSocket({ connecter: () => Promise.resolve(socketPc), modeIntegrite: 'perte_silencieuse' }),
  };
}

// -- Doublure du worker : jamais de spawn réel en test (règle du dépôt) --------

function capacites(): WorkerCapabilities {
  return { advertised: [], claudeCodeVersion: '2.1.217', tools: ['Bash'], mcpServers: [], model: 'claude-sonnet-4-6', sessionId: SESSION_ID };
}

function fakeQuery(messages: readonly SDKMessage[]): Query {
  async function* flux(): AsyncGenerator<SDKMessage, void> {
    for (const message of messages) yield message;
  }
  return Object.assign(flux(), {
    interrupt: async () => ({ still_queued: [] }),
    close: (): void => {},
    reinitialize: async () => ({ commands: [], agents: [], models: [] }),
  }) as unknown as Query;
}

function spec(): WorkerSpec {
  return {
    sessionId: SESSION_ID,
    cwd: '/tmp/worktree-partiel',
    mandate: 'team leader',
    // Audit inactif EXPLICITEMENT sur cette doublure (H-74) : jamais une omission.
    mcpServers: {},
    portAuditPermissions: () => ({}),
    deniedToolPatterns: [],
    maxBudgetUsd: 25,
  };
}

function demande(): DemandeDemarrage {
  return { missionId: MISSION_ID, epoch: 1, spec: spec(), promptInitial: 'go' };
}

function demarrerWorkerFactice(messages: readonly SDKMessage[]) {
  return async (workerSpec: WorkerSpec): Promise<WorkerHandle> => ({
    sessionId: workerSpec.sessionId,
    cwd: workerSpec.cwd,
    capabilities: capacites(),
    model: { requested: 'sonnet', resolved: 'claude-sonnet-4-6' } as WorkerHandle['model'],
    preflight: {
      ok: true,
      cwd: workerSpec.cwd,
      loadedSources: [],
      machineClaudeMdPath: null,
      projectClaudeMdPaths: [],
      effectiveModel: null,
      failures: [],
    },
    pid: null,
    pidStarttime: null,
    abortController: new AbortController(),
    query: fakeQuery(messages),
  });
}

/** Forme réelle d'un `stream_event` — sonde large, jamais castée précisément. */
function evenementFlux(event: Record<string, unknown>): SDKMessage {
  return { type: 'stream_event', parent_tool_use_id: null, event, uuid: SESSION_ID, session_id: SESSION_ID } as unknown as SDKMessage;
}

function debutBlocReflexion(): SDKMessage {
  return evenementFlux({ type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } });
}

function jetonReflexion(texte: string): SDKMessage {
  return evenementFlux({ type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: texte } });
}

// -- Montage de la chaîne -----------------------------------------------------

interface ChaineMontee {
  readonly superviseur: SuperviseurWorkers;
  readonly registre: Registre;
  readonly serveur: ServeurApiWeb;
  readonly fermer: () => void;
}

/** Assemble le PC réel : registre d'observation nourri par le superviseur, canal de contrôle. */
function monterPc(
  lienPc: LienWebSocket,
  messages: readonly SDKMessage[],
  cablerObservateur: boolean,
): SuperviseurWorkers {
  const observationParc = new RegistreObservationParc();
  const superviseur = new SuperviseurWorkers({
    compteurRelances: new CompteurRelances(),
    // Le seul point de câblage que la validation « dans les deux sens » débranche.
    ...(cablerObservateur ? { observateurFlux: observationParc } : {}),
    demarrerWorker: demarrerWorkerFactice(messages),
  });
  cablerRecepteurControlePc(superviseur, lienPc, {
    lecteurPartielsFlux: (missionId) => observationParc.demanderPartielLead(missionId),
  });
  return superviseur;
}

function semerMission(registre: Registre): void {
  const lot = registre.lots.creer({ id: 'lot-1', intention: 'banc du partiel de flux' });
  registre.comptes.enregistrer({ id: 'compte-a', configDir: '/tmp/a', email: 'a@exemple.fr' });
  registre.missions.creer({
    id: MISSION_ID,
    lotId: lot.id,
    nom: 'Regarder le lead écrire',
    projet: 'ccremote',
    compteId: 'compte-a',
    mandat: 'brancher le flux',
    critereArret: 'partial visible',
  });
}

async function monterChaine(
  messages: readonly SDKMessage[],
  options: { readonly cablerObservateur?: boolean } = {},
): Promise<ChaineMontee> {
  const { pi, pc } = creerPaireLiens();
  await Promise.all([pi.connecter(), pc.connecter()]);
  const superviseur = monterPc(pc, messages, options.cablerObservateur !== false);

  const registre = ouvrirRegistre({ chemin: ':memory:' });
  semerMission(registre);
  const parc = new ParcSuperviseurs({ registre, enLigne: () => true });
  parc.enregistrer('pc', new ClientSuperviseurPc(pi, { timeoutMs: 2000 }));
  const partielsMissions = new EtatPartielsMissions({
    source: (missionId) => parc.pourMission(missionId).client.partielMission(missionId),
  });
  const serveur = demarrerServeurApiWeb({ port: 0, registre, pcEnLigne: () => true, partielsMissions });

  return {
    superviseur,
    registre,
    serveur,
    fermer: (): void => {
      serveur.arreter();
      registre.fermer();
      pi.fermer();
      pc.fermer();
    },
  };
}

async function lireMission(serveur: ServeurApiWeb): Promise<Record<string, unknown>> {
  const rep = await fetch(`http://127.0.0.1:${serveur.port}/api/harness/missions/${MISSION_ID}`);
  const corps = (await rep.json()) as { data: Record<string, unknown> };
  return corps.data;
}

/**
 * Sonde la route comme le ferait l'interface, jusqu'à ce que `partial` cesse
 * d'être `null`. `☠` BORNÉE (JPL) : `maxTours` tours au plus, jamais une attente
 * indéfinie — un câblage rompu doit faire ÉCHOUER ce test, pas le faire pendre.
 */
async function sonderJusquAuPartiel(
  serveur: ServeurApiWeb,
  maxTours = 40,
): Promise<{ readonly type: string; readonly contenu: string } | null> {
  for (let tour = 0; tour < maxTours; tour += 1) {
    const mission = await lireMission(serveur);
    const partial = mission['partial'] as { type: string; contenu: string } | null;
    if (partial !== null) return partial;
    await new Promise((resoudre) => setTimeout(resoudre, 5));
  }
  return null;
}

let chaine: ChaineMontee | null = null;

afterEach(() => {
  chaine?.fermer();
  chaine = null;
});

describe('assemblage — un `stream_event` entré côté superviseur ressort en `partial` sur la vue mission', () => {
  test('☠ la chaîne complète, du flux SDK au JSON de `/missions/:id`', async () => {
    chaine = await monterChaine([debutBlocReflexion(), jetonReflexion('je relis le mandat')]);

    // Premier sondage : il ne rend RIEN et c'est normal — c'est lui qui DÉCLARE
    // l'observation à la machine (aucune boucle ne le fait à sa place). Tant que
    // personne n'a regardé, le registre ignore les messages de cette équipe.
    expect((await lireMission(chaine.serveur))['partial']).toBeNull();
    await new Promise((resoudre) => setTimeout(resoudre, 20));

    await chaine.superviseur.demarrer(demande());

    const partial = await sonderJusquAuPartiel(chaine.serveur);
    expect(partial).toEqual({ type: 'reflexion', contenu: 'je relis le mandat' });
  });

  test('la LISTE des missions ne porte jamais de partiel — ciblée, jamais tout le parc', async () => {
    chaine = await monterChaine([debutBlocReflexion(), jetonReflexion('x')]);
    await chaine.superviseur.demarrer(demande());
    await sonderJusquAuPartiel(chaine.serveur);

    const rep = await fetch(`http://127.0.0.1:${chaine.serveur.port}/api/harness/missions`);
    const corps = (await rep.json()) as { data: readonly Record<string, unknown>[] };
    expect(corps.data[0]?.['partial']).toBeNull();
  });

  test('☠ bornée : un pavé de réflexion ne traverse le lien que tronqué, et par la QUEUE', async () => {
    const pave = `${'A'.repeat(40_000)}FIN`;
    chaine = await monterChaine([debutBlocReflexion(), jetonReflexion(pave)]);

    await lireMission(chaine.serveur);
    await new Promise((resoudre) => setTimeout(resoudre, 20));
    await chaine.superviseur.demarrer(demande());

    const partial = await sonderJusquAuPartiel(chaine.serveur);
    expect(partial?.contenu.length).toBe(TAILLE_MAX_PARTIEL_FLUX);
    // La FIN est conservée : c'est ce que l'agent est en train d'écrire.
    expect(partial?.contenu.endsWith('FIN')).toBe(true);
  });

  test('☠ validation dans l’autre sens : sans le port `observateurFlux`, `partial` reste `null` pour toujours', async () => {
    chaine = await monterChaine([debutBlocReflexion(), jetonReflexion('je relis le mandat')], {
      cablerObservateur: false,
    });

    await lireMission(chaine.serveur);
    await new Promise((resoudre) => setTimeout(resoudre, 20));
    await chaine.superviseur.demarrer(demande());

    // Même sondage, même patience : le seul câblage retiré suffit à tout éteindre.
    expect(await sonderJusquAuPartiel(chaine.serveur, 10)).toBeNull();
  });

  test('un `result` referme le bloc : plus rien n’est « en cours de frappe »', async () => {
    const resultat = {
      type: 'result',
      subtype: 'success',
      duration_ms: 1,
      duration_api_ms: 1,
      is_error: false,
      num_turns: 1,
      result: 'ok',
      stop_reason: null,
      total_cost_usd: 0.01,
      usage: {},
      modelUsage: {},
      permission_denials: [],
      terminal_reason: 'completed',
      uuid: SESSION_ID,
      session_id: SESSION_ID,
    } as unknown as SDKMessage;
    chaine = await monterChaine([debutBlocReflexion(), jetonReflexion('pensée coupée'), resultat]);

    await lireMission(chaine.serveur);
    await new Promise((resoudre) => setTimeout(resoudre, 20));
    await chaine.superviseur.demarrer(demande());

    expect(await sonderJusquAuPartiel(chaine.serveur, 10)).toBeNull();
  });
});
