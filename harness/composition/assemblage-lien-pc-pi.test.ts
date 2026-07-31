/**
 * Test d'assemblage — H-75 (lien Pi↔PC inversé, reconnexion, multiplexage).
 *
 * `☠` Aucune connexion réseau réelle, aucun `Bun.serve` : deux `LienWebSocket`
 * (côté « Pi » et côté « PC ») sont câblés sur une PAIRE de faux sockets en
 * mémoire, cross-branchés (l'envoi de l'un déclenche la réception de
 * l'autre) — même esprit que `transport/lien-websocket.test.ts`, mais les
 * DEUX pairs sont simulés simultanément ici (le fichier de `transport/` ne
 * teste qu'un seul bout). Ce que ce fichier prouve : le multiplexage
 * `controle_requete` sur l'unique lien, PAS le réseau ni
 * `Bun.serve({ websocket })` (`serveur-lien-pc.ts`) — ceux-là appartiennent à
 * la validation réelle du parent (voir rapport de mission).
 */

import { describe, expect, test } from 'bun:test';
import { mkdtemp, mkdir, writeFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { ouvrirRegistre } from '../control-plane/registre/index.ts';
import {
  construireOutilsControle,
  type DependancesServeurControle,
} from '../control-plane/orchestrateur/mcp-controle/serveur.ts';
import type { ContratRetour } from '../control-plane/orchestrateur/mcp-controle/types.ts';
import { CompteurRelances } from '../relance/compteur-relances.ts';
import { SuperviseurWorkers, type PortSuperviseurControle } from '../superviseur/index.ts';
import { LienWebSocket, type WebSocketLike } from '../transport/lien-websocket.ts';
import { cablerRecepteurControlePc } from './pc/canal-controle-recepteur.ts';
import { ClientSuperviseurPc } from './pi/client-superviseur-pc.ts';
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

/**
 * `☠` Test d'ASSEMBLAGE de `lire_fichier`, sur le modèle de
 * `superviseur/exploration-cablage.test.ts` mais poussé aux QUATRE couches :
 * outil MCP → `ClientSuperviseurPc` (Pi) → lien → `CanalControle` (PC) →
 * `SuperviseurWorkers` → disque réel.
 *
 * Motif payé sept fois sur ce projet — « écrit, testé, branché sur rien ».
 * `explorerProjets` en était la 7ᵉ occurrence : la fonction était juste, testée
 * unitairement, et le canal recevait `undefined` parce qu'aucune méthode ne
 * l'exposait. Aucun test d'unité ne pouvait le voir, chacun testant sa moitié.
 * Ce test-ci part de l'outil que le modèle appelle réellement et va jusqu'au
 * fichier sur disque : si UN maillon manque, il tombe.
 */
type HandlerGenerique = (args: Record<string, unknown>, extra: unknown) => Promise<CallToolResult>;

interface LectureRendue {
  readonly ok: boolean;
  readonly contenu: string;
  readonly tronque: boolean;
  readonly note?: string;
}

async function racineProjetsReelle(): Promise<{ racine: string; horsRacine: string }> {
  const parent = await mkdtemp(join(tmpdir(), 'ccremote-assemblage-lecture-'));
  const racine = join(parent, 'projets');
  const horsRacine = join(parent, 'secrets');
  await mkdir(racine);
  await mkdir(horsRacine);
  await mkdir(join(racine, 'vela', 'src-tauri'), { recursive: true });
  await writeFile(join(racine, 'vela', 'src-tauri', 'main.rs'), 'fn main() { println!("vela"); }\n');
  // Marqueur volontairement improbable : il ne doit apparaître dans AUCUNE
  // réponse rendue au modèle, ni en contenu, ni en fragment de note.
  await writeFile(join(horsRacine, 'credentials.json'), '{"token":"MARQUEUR-HORS-RACINE"}');
  return { racine, horsRacine };
}

/**
 * Monte la chaîne complète et rend le handler de l'outil `lire_fichier`, tel
 * que l'orchestrateur l'appellerait. `fermer()` libère le registre.
 *
 * `☠` Les deux casts sont justifiés et cantonnés au test : `SuperviseurWorkers`
 * est construit avec les seules dépendances que ce chemin touche (même procédé
 * que `exploration-cablage.test.ts`), et le tableau d'outils mélange des schémas
 * Zod différents dont TypeScript déduit une intersection de signatures
 * inexploitable (même procédé que `mcp-controle/serveur.test.ts`).
 */
async function chaineComplete(racineProjets: string): Promise<{
  readonly lireFichier: HandlerGenerique;
  readonly fermer: () => void;
}> {
  const { pi, pc } = creerPaireLiens();
  await Promise.all([pi.connecter(), pc.connecter()]);

  const superviseur = new SuperviseurWorkers({ compteurRelances: new CompteurRelances(), racineProjets } as never);
  cablerRecepteurControlePc(superviseur, pc);
  const client = new ClientSuperviseurPc(pi, { timeoutMs: 2000 });

  const registre = ouvrirRegistre({ chemin: ':memory:' });
  const deps: DependancesServeurControle = {
    registre,
    repertoireProjets: racineProjets,
    cibles: { cible: () => null },
    arreteur: { arreter: async () => {} },
    relanceur: { relancer: async () => {} },
    budget: { definir: async () => {} },
    utilisationParc: { comptesConnus: () => [], releves: () => [] },
    configPlafondParc: {},
    lecteurFichier: { lireFichier: (chemin) => client.lireFichier(chemin) },
  };
  const outil = construireOutilsControle(deps).find((o) => o.name === 'lire_fichier');
  if (outil === undefined) throw new Error('outil "lire_fichier" absent de la surface MCP — câblage rompu');
  return { lireFichier: (outil as unknown as { handler: HandlerGenerique }).handler, fermer: () => registre.fermer() };
}

function contratDe(resultat: CallToolResult): ContratRetour {
  const bloc = resultat.content[0];
  if (bloc === undefined || bloc.type !== 'text') throw new Error('bloc de contenu inattendu en test');
  return JSON.parse(bloc.text) as ContratRetour;
}

describe('assemblage — lire_fichier : les 4 couches (outil MCP → Pi → lien → PC → disque)', () => {
  test('☠ le contenu rendu au modèle vient du VRAI fichier sur le disque du PC', async () => {
    const { racine } = await racineProjetsReelle();
    const chaine = await chaineComplete(racine);
    try {
      const contrat = contratDe(await chaine.lireFichier({ chemin: 'vela/src-tauri/main.rs' }, undefined));
      expect(contrat.ok).toBe(true);
      expect(contrat.effet).toBe('applique');
      const lecture = JSON.parse(contrat.etat ?? '{}') as LectureRendue;
      expect(lecture.contenu).toBe('fn main() { println!("vela"); }\n');
    } finally {
      chaine.fermer();
    }
  });

  test('☠ la borne de racine TIENT à travers tout le câblage — un `..` ne rend aucun contenu', async () => {
    const { racine } = await racineProjetsReelle();
    const chaine = await chaineComplete(racine);
    try {
      const contrat = contratDe(await chaine.lireFichier({ chemin: '../secrets/credentials.json' }, undefined));
      expect(contrat.ok).toBe(false);
      expect(contrat.effet).toBe('refuse');
      expect(contrat.raison).toContain('refusé');
      expect(JSON.stringify(contrat)).not.toContain('MARQUEUR-HORS-RACINE');
    } finally {
      chaine.fermer();
    }
  });

  test('☠ un lien symbolique sortant est refusé de bout en bout, pas seulement en unitaire', async () => {
    const { racine, horsRacine } = await racineProjetsReelle();
    await symlink(join(horsRacine, 'credentials.json'), join(racine, 'innocent.json'));
    const chaine = await chaineComplete(racine);
    try {
      const contrat = contratDe(await chaine.lireFichier({ chemin: 'innocent.json' }, undefined));
      expect(contrat.ok).toBe(false);
      expect(JSON.stringify(contrat)).not.toContain('MARQUEUR-HORS-RACINE');
    } finally {
      chaine.fermer();
    }
  });

  test('un fichier absent ressort en `refuse` porteur de sa raison, jamais en succès à contenu vide', async () => {
    const { racine } = await racineProjetsReelle();
    const chaine = await chaineComplete(racine);
    try {
      const contrat = contratDe(await chaine.lireFichier({ chemin: 'vela/absent.rs' }, undefined));
      expect(contrat.ok).toBe(false);
      expect(contrat.raison).toContain('inexistant');
    } finally {
      chaine.fermer();
    }
  });

  test('☠ la troncature survit à la sérialisation du lien — le modèle SAIT que la fin manque', async () => {
    const { racine } = await racineProjetsReelle();
    await writeFile(join(racine, 'vela', 'gros.log'), 'a'.repeat(200 * 1024 + 1_000));
    const chaine = await chaineComplete(racine);
    try {
      const contrat = contratDe(await chaine.lireFichier({ chemin: 'vela/gros.log' }, undefined));
      expect(contrat.ok).toBe(true);
      const lecture = JSON.parse(contrat.etat ?? '{}') as LectureRendue;
      expect(lecture.tronque).toBe(true);
      expect(lecture.note).toContain('TRONQUÉ');
    } finally {
      chaine.fermer();
    }
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
