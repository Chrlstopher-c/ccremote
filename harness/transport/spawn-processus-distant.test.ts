import { describe, expect, test } from 'bun:test';
import type { SpawnOptions } from '@anthropic-ai/claude-agent-sdk';
import { creerSpawnProcessusDistant } from './spawn-processus-distant.ts';
import type { CanalControleProcessus, EtatLien, FermetureTerminale, Lien, Tuyau } from './contrat.ts';

/** Tuyau en mémoire : ce que le test écrit est ce que le test peut relire. */
class TuyauMemoire implements Tuyau {
  #emis = 0;
  #recus = 0;
  readonly ecrits: Uint8Array[] = [];
  readonly #abonnes: Array<(o: Uint8Array) => void> = [];

  ecrire(octets: Uint8Array): void {
    this.ecrits.push(octets);
    this.#emis += octets.length;
  }

  surOctets(abonne: (o: Uint8Array) => void): void {
    this.#abonnes.push(abonne);
  }

  /** Simule une arrivée réseau sur ce tuyau (utilisé pour `versPi`, le sens PC→Pi). */
  injecter(octets: Uint8Array): void {
    this.#recus += octets.length;
    for (const a of this.#abonnes) a(octets);
  }

  octetsEmis(): number {
    return this.#emis;
  }

  octetsRecus(): number {
    return this.#recus;
  }
}

/** Fake minimal du Lien + canal de contrôle, contrôlable pas à pas par le test. */
class LienFactice implements Lien, CanalControleProcessus {
  readonly stdin = new TuyauMemoire();
  readonly stdout = new TuyauMemoire();
  readonly killsEnvoyes: string[] = [];
  #ferme = false;
  readonly #abonnesStderr: Array<(t: string) => void> = [];
  readonly #abonnesExit: Array<(c: number | null, s: string | null) => void> = [];
  readonly #abonnesErreurSpawn: Array<(m: string) => void> = [];
  readonly #abonnesFermeture: Array<(f: FermetureTerminale) => void> = [];

  etat(): EtatLien {
    return this.#ferme ? 'ferme_terminal' : 'ouvert';
  }

  versPc(): Tuyau {
    return this.stdin;
  }

  versPi(): Tuyau {
    return this.stdout;
  }

  surFermeture(a: (f: FermetureTerminale) => void): void {
    this.#abonnesFermeture.push(a);
  }

  remonteesTransitoires(): number {
    return 0;
  }

  rattachements(): number {
    return 0;
  }

  fermer(): void {
    this.#ferme = true;
  }

  envoyerKill(signal: string): void {
    this.killsEnvoyes.push(signal);
  }

  surStderr(a: (t: string) => void): void {
    this.#abonnesStderr.push(a);
  }

  surExit(a: (c: number | null, s: string | null) => void): void {
    this.#abonnesExit.push(a);
  }

  surErreurSpawn(a: (m: string) => void): void {
    this.#abonnesErreurSpawn.push(a);
  }

  emettreExit(code: number | null, signal: string | null): void {
    for (const a of this.#abonnesExit) a(code, signal);
  }

  emettreErreurSpawn(message: string): void {
    for (const a of this.#abonnesErreurSpawn) a(message);
  }

  emettreStderr(texte: string): void {
    for (const a of this.#abonnesStderr) a(texte);
  }

  declencherFermetureTerminale(raison: string): void {
    this.#ferme = true;
    const fermeture: FermetureTerminale = { terminal: true, code: 4092, raison, rattachementAutorise: true };
    for (const a of this.#abonnesFermeture) a(fermeture);
  }
}

function optionsSpawn(signal: AbortSignal): SpawnOptions {
  return { command: 'claude', args: [], env: {}, signal };
}

describe('creerSpawnProcessusDistant — adapter B.2.1/B.2.2/B.2.3', () => {
  test('stdin écrit atteint le tuyau versPc en octets bruts (H-12 : jamais interprété)', () => {
    const lien = new LienFactice();
    const abortController = new AbortController();
    const spawn = creerSpawnProcessusDistant(lien, abortController);
    const processus = spawn(optionsSpawn(new AbortController().signal));

    processus.stdin.write(Buffer.from('{"type":"user"}'));

    expect(lien.stdin.ecrits).toHaveLength(1);
    expect(Buffer.from(lien.stdin.ecrits[0]!).toString()).toBe('{"type":"user"}');
  });

  test('stdout reçoit ce que le lien injecte sur versPi', async () => {
    const lien = new LienFactice();
    const spawn = creerSpawnProcessusDistant(lien, new AbortController());
    const processus = spawn(optionsSpawn(new AbortController().signal));

    const recu = new Promise<Buffer>((resolve) => processus.stdout.once('data', (c: Buffer) => resolve(c)));
    lien.stdout.injecter(Buffer.from('{"type":"system"}'));

    expect((await recu).toString()).toBe('{"type":"system"}');
  });

  test('kill(signal) relaie au lien et marque killed', () => {
    const lien = new LienFactice();
    const spawn = creerSpawnProcessusDistant(lien, new AbortController());
    const processus = spawn(optionsSpawn(new AbortController().signal));

    const resultat = processus.kill('SIGTERM');

    expect(resultat).toBe(true);
    expect(processus.killed).toBe(true);
    expect(lien.killsEnvoyes).toEqual(['SIGTERM']);
  });

  test('critère (c) — stderr rapatrié, une erreur de hook y est visible', () => {
    const lien = new LienFactice();
    const recus: string[] = [];
    const spawn = creerSpawnProcessusDistant(lien, new AbortController(), { onStderr: (d) => recus.push(d) });
    spawn(optionsSpawn(new AbortController().signal));

    const messageHook = "PreToolUse hook 'garde-fou' a échoué : exit 1";
    lien.emettreStderr(messageHook);

    expect(recus).toEqual([messageHook]);
  });

  test('critère (d) — arrêt immédiat via abortController capturé en closure, pas via options.signal', () => {
    const lien = new LienFactice();
    const abortController = new AbortController();
    const spawn = creerSpawnProcessusDistant(lien, abortController);
    const processus = spawn(optionsSpawn(new AbortController().signal)); // signal SDK distinct, jamais déclenché

    abortController.abort();

    expect(processus.killed).toBe(true);
    expect(lien.killsEnvoyes).toEqual(['SIGKILL']);
  });

  test('critère (d) — teardown lourd sur options.signal ferme le lien, sans kill immédiat', () => {
    const lien = new LienFactice();
    const controleurSdk = new AbortController();
    const spawn = creerSpawnProcessusDistant(lien, new AbortController());
    spawn(optionsSpawn(controleurSdk.signal));

    controleurSdk.abort();

    expect(lien.etat()).toBe('ferme_terminal');
    expect(lien.killsEnvoyes).toEqual([]); // le teardown ferme le lien, il ne tue pas
  });

  test('exit distant explicite se propage avec code et signal', () => {
    const lien = new LienFactice();
    const spawn = creerSpawnProcessusDistant(lien, new AbortController());
    const processus = spawn(optionsSpawn(new AbortController().signal));

    const exits: Array<[number | null, string | null]> = [];
    processus.on('exit', (code, signal) => exits.push([code, signal]));
    lien.emettreExit(0, null);

    expect(exits).toEqual([[0, null]]);
    expect(processus.exitCode).toBe(0);
  });

  test('once() ne se déclenche qu’une fois puis se désabonne', () => {
    const lien = new LienFactice();
    const spawn = creerSpawnProcessusDistant(lien, new AbortController());
    const processus = spawn(optionsSpawn(new AbortController().signal));

    let appels = 0;
    processus.once('exit', () => {
      appels += 1;
    });
    lien.emettreExit(0, null);
    lien.emettreExit(0, null);

    expect(appels).toBe(1);
  });

  test('fermeture terminale du lien sans EXIT explicite ne produit pas un exit nu (panne B.1.5)', () => {
    const lien = new LienFactice();
    const spawn = creerSpawnProcessusDistant(lien, new AbortController());
    const processus = spawn(optionsSpawn(new AbortController().signal));

    const erreurs: Error[] = [];
    const exits: Array<[number | null, string | null]> = [];
    processus.on('error', (e) => erreurs.push(e));
    processus.on('exit', (code, signal) => exits.push([code, signal]));

    lien.declencherFermetureTerminale('epoch dépassé — plus le worker actif');

    expect(erreurs).toHaveLength(1);
    expect(erreurs[0]!.message).toContain('epoch dépassé');
    expect(exits).toEqual([[null, null]]);
  });

  test('erreur de spawn côté PC remonte comme événement error, pas comme exit', () => {
    const lien = new LienFactice();
    const spawn = creerSpawnProcessusDistant(lien, new AbortController());
    const processus = spawn(optionsSpawn(new AbortController().signal));

    const erreurs: Error[] = [];
    const exits: unknown[] = [];
    processus.on('error', (e) => erreurs.push(e));
    processus.on('exit', () => exits.push(true));

    lien.emettreErreurSpawn('binaire introuvable sur le PC');

    expect(exits).toHaveLength(0);
    expect(erreurs).toHaveLength(1);
    expect(erreurs[0]!.message).toContain('binaire introuvable sur le PC');
  });
});
