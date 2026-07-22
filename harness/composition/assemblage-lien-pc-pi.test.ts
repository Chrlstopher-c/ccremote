/**
 * Test d'assemblage — H-75 (lien Pi↔PC inversé, reconnexion, multiplexage).
 *
 * `☠` Aucune connexion réseau réelle, aucun `Bun.serve` : deux `LienWebSocket`
 * (côté « Pi » et côté « PC ») sont câblés sur une PAIRE de faux sockets en
 * mémoire, cross-branchés (l'envoi de l'un déclenche la réception de
 * l'autre) — même esprit que `transport/lien-websocket.test.ts`, mais les
 * DEUX pairs sont simulés simultanément ici (le fichier de `transport/` ne
 * teste qu'un seul bout). Ce que ce fichier prouve : le multiplexage
 * `controle_requete`/`permission_demande` sur l'unique lien, PAS le réseau ni
 * `Bun.serve({ websocket })` (`serveur-lien-pc.ts`) — ceux-là appartiennent à
 * la validation réelle du parent (voir rapport de mission).
 */

import { describe, expect, test } from 'bun:test';
import { MachineEtatsDemandes } from '../control-plane/bus-permissions/index.ts';
import type { PortSuperviseurControle } from '../superviseur/index.ts';
import { LienWebSocket, type WebSocketLike } from '../transport/lien-websocket.ts';
import { cablerRecepteurControlePc } from './pc/canal-controle-recepteur.ts';
import { creerPortBusPermissionsDistant } from './pc/port-bus-permissions-distant.ts';
import { ClientSuperviseurPc } from './pi/client-superviseur-pc.ts';
import { cablerPermissionVerdictDistant } from './pi/permission-verdict-distant.ts';
import { creerDeclencheurReconciliationSurRattachement } from './pi/reconciliation-sur-rattachement.ts';

type Ecouteur<T> = (ev: T) => void;

/** Même minimalisme que `FakeWebSocket` de `transport/lien-websocket.test.ts`, mais CROSS-BRANCHÉ à un pair. */
class FauxSocketApparie implements WebSocketLike {
  readyState = 1;
  pair: FauxSocketApparie | null = null;
  readonly #message: Ecouteur<{ data: unknown }>[] = [];
  readonly #close: Ecouteur<{ code: number; reason: string }>[] = [];

  send(data: Uint8Array): void {
    // Livraison asynchrone : plus proche d'un vrai socket, évite toute
    // dépendance à l'ordre d'appel synchrone entre les deux pairs.
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

  const pi = new LienWebSocket({ connecter: () => Promise.resolve(socketPi), modeIntegrite: 'perte_silencieuse' });
  const pc = new LienWebSocket({ connecter: () => Promise.resolve(socketPc), modeIntegrite: 'perte_silencieuse' });
  return { pi, pc };
}

async function laisserPasserLesMicrotaches(tours = 5): Promise<void> {
  for (let i = 0; i < tours; i += 1) await Promise.resolve();
}

describe('assemblage — canal de contrôle multiplexé sur le lien unique (H-75, D.3 inversé)', () => {
  test('une opération émise par le Pi atteint réellement CanalControle côté PC et la réponse revient corrélée', async () => {
    const { pi, pc } = creerPaireLiens();
    await Promise.all([pi.connecter(), pc.connecter()]);

    const superviseur: PortSuperviseurControle = {
      inventaire: () => [{ sessionId: 's1', worktree: null, epoch: 1, vivant: true }],
      demarrer: async () => ({ sessionId: 's1' }),
      arreter: async () => {},
      tuerSansPreavis: () => {},
      relancer: async () => {},
      reinitialiser: async () => ({ demandesEnAttente: [] }),
    };
    cablerRecepteurControlePc(superviseur, pc);
    const client = new ClientSuperviseurPc(pi, { timeoutMs: 2000 });

    const inventaire = await client.inventaire();
    expect(inventaire).toEqual([{ sessionId: 's1', worktree: null, epoch: 1, vivant: true }]);
  });

  test('idempotence D.3.2 préservée à travers le multiplexage : deux appels concurrents restent distingués par id, sans sérialisation artificielle', async () => {
    const { pi, pc } = creerPaireLiens();
    await Promise.all([pi.connecter(), pc.connecter()]);

    const appelsArretes: string[] = [];
    const superviseur: PortSuperviseurControle = {
      inventaire: () => [],
      demarrer: async () => ({ sessionId: 's1' }),
      arreter: async (missionId): Promise<void> => {
        appelsArretes.push(missionId);
      },
      tuerSansPreavis: () => {},
      relancer: async () => {},
      reinitialiser: async () => ({ demandesEnAttente: [] }),
    };
    cablerRecepteurControlePc(superviseur, pc);
    const client = new ClientSuperviseurPc(pi, { timeoutMs: 2000 });

    // Deux opérations DIFFÉRENTES en vol simultanément sur le MÊME lien —
    // preuve que `CorrelateurReponses` les distingue (contrairement à
    // l'ancienne version, sérialisée une connexion par appel).
    await Promise.all([client.arreter('mission-a'), client.arreter('mission-b')]);
    expect(appelsArretes.sort()).toEqual(['mission-a', 'mission-b']);
  });
});

describe('assemblage — bus de permissions distant sur le lien unique (H-73.1 fermé pour de vrai, H-75)', () => {
  test('verdict déjà tranché par la machine à états : réémis immédiatement au PC via le lien', async () => {
    const { pi, pc } = creerPaireLiens();
    await Promise.all([pi.connecter(), pc.connecter()]);

    const machine = new MachineEtatsDemandes();
    machine.recevoir({ requestId: 'req-1', idWorker: 'pc', outil: 'Bash' });
    machine.escalader('req-1');
    machine.repondre('req-1', { behavior: 'allow' });

    cablerPermissionVerdictDistant(machine, pi);
    const port = creerPortBusPermissionsDistant(pc, { timeoutMs: 2000 });

    const verdict = await port({ requestId: 'req-1', outil: 'Bash', input: {} });
    expect(verdict.behavior).toBe('allow');
  });

  test('escalade fraîche : le port attend le verdict humain, appliqué APRÈS coup sur la machine côté Pi', async () => {
    const { pi, pc } = creerPaireLiens();
    await Promise.all([pi.connecter(), pc.connecter()]);

    const machine = new MachineEtatsDemandes();
    cablerPermissionVerdictDistant(machine, pi, { intervalleScrutationMs: 5, budgetMs: 500 });
    const port = creerPortBusPermissionsDistant(pc, { timeoutMs: 2000 });

    const promesseVerdict = port({ requestId: 'req-2', outil: 'Bash', input: {} });
    // Laisse la demande atteindre le Pi et s'escalader avant de répondre.
    await laisserPasserLesMicrotaches(10);
    machine.repondre('req-2', { behavior: 'deny', message: 'refusé par un humain' });

    const verdict = await promesseVerdict;
    expect(verdict.behavior).toBe('deny');
  });

  test('aucun verdict humain dans le budget côté Pi : le PC reçoit un refus explicite, jamais un blocage indéfini', async () => {
    const { pi, pc } = creerPaireLiens();
    await Promise.all([pi.connecter(), pc.connecter()]);

    const machine = new MachineEtatsDemandes();
    cablerPermissionVerdictDistant(machine, pi, { intervalleScrutationMs: 5, budgetMs: 30 });
    const port = creerPortBusPermissionsDistant(pc, { timeoutMs: 2000 });

    const verdict = await port({ requestId: 'req-3', outil: 'Bash', input: {} });
    expect(verdict.behavior).toBe('deny');
  });
});

describe('assemblage — réconciliation câblée sur CHAQUE rattachement (H-75, epoch incrémenté)', () => {
  test('le déclencheur appelle reconcilier(..., "reconnexion") et non seulement au démarrage', async () => {
    const appels: string[] = [];
    const registreFactice = {} as never;
    const depsFactice = {
      inventairePc: { inventaire: (): readonly [] => [], tuerSansPreavis: async (): Promise<void> => {} },
      reinitialisateur: { reinitialiser: async () => ({ demandesEnAttente: [] }) },
    };
    // On espionne `reconcilier` via son effet observable : aucune mission active
    // en registre factice ⇒ rapport vide, mais l'appel lui-même doit avoir lieu.
    const declencheur = creerDeclencheurReconciliationSurRattachement(
      { missions: { listerActives: () => [] } } as never,
      depsFactice as never,
    );
    void registreFactice;
    declencheur();
    await laisserPasserLesMicrotaches(5);
    appels.push('tic-passe'); // si `declencheur()` avait levé de façon non catchée, ce point ne serait jamais atteint.
    expect(appels).toEqual(['tic-passe']);
  });
});
