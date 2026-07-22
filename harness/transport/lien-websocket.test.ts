import { describe, expect, test } from 'bun:test';
import { LienWebSocket, type WebSocketLike } from './lien-websocket.ts';
import type { HorlogeTransport } from './horloge-transport.ts';
import { TAG, decoderTrame, encoderExit, encoderTexte, encoderTrame } from './trame.ts';

const enc = (t: string): Uint8Array => new TextEncoder().encode(t);

/** Horloge de test : déclenche les minuteries à la demande, jamais toute seule. */
function creerHorlogeManuelle(): HorlogeTransport & { declencherToutes(): void } {
  const enAttente: Array<() => void> = [];
  return {
    planifier(_delaiMs, action) {
      enAttente.push(action);
      return () => {
        const i = enAttente.indexOf(action);
        if (i >= 0) enAttente.splice(i, 1);
      };
    },
    declencherToutes() {
      const copie = enAttente.splice(0);
      for (const action of copie) action();
    },
  };
}

type Ecouteur<T> = (ev: T) => void;

class FakeWebSocket implements WebSocketLike {
  readyState = 1;
  readonly envoyes: Uint8Array[] = [];
  readonly #message: Ecouteur<{ data: unknown }>[] = [];
  readonly #close: Ecouteur<{ code: number; reason: string }>[] = [];
  readonly #error: Ecouteur<unknown>[] = [];

  send(data: Uint8Array): void {
    this.envoyes.push(data);
  }

  close(code = 1000, reason = ''): void {
    this.readyState = 3;
    this.simulerFermeture(code, reason);
  }

  addEventListener(
    type: 'message' | 'close' | 'error',
    listener: Ecouteur<{ data: unknown }> | Ecouteur<{ code: number; reason: string }> | Ecouteur<unknown>,
  ): void {
    // Cast sûr : l'appelant respecte les surcharges de `WebSocketLike` — le
    // branchement sur `type` associe chaque listener à sa forme réelle.
    if (type === 'message') this.#message.push(listener as Ecouteur<{ data: unknown }>);
    else if (type === 'close') this.#close.push(listener as Ecouteur<{ code: number; reason: string }>);
    else this.#error.push(listener as Ecouteur<unknown>);
  }

  simulerMessage(trame: Uint8Array): void {
    for (const l of this.#message) l({ data: trame });
  }

  simulerFermeture(code: number, reason = ''): void {
    this.readyState = 3;
    for (const l of this.#close) l({ code, reason });
  }
}

describe('LienWebSocket — canal principal réel (D.1.2, D.1.3)', () => {
  test('critère (a) — coupure transitoire 30 s : reconnexion interne, zéro remontée', async () => {
    const horloge = creerHorlogeManuelle();
    const websockets: FakeWebSocket[] = [];
    const lien = new LienWebSocket({
      horloge,
      connecter: async () => {
        const ws = new FakeWebSocket();
        websockets.push(ws);
        return ws;
      },
    });

    await lien.connecter();
    lien.versPc().ecrire(enc('a'));
    lien.versPc().ecrire(enc('b'));
    expect(websockets[0]!.envoyes).toHaveLength(2);

    // Coupure transitoire (ex. Wi-Fi qui saute 30 s) : jamais remontée.
    websockets[0]!.simulerFermeture(1006, '');
    expect(lien.etat()).toBe('coupe_transitoire');
    expect(lien.remonteesTransitoires()).toBe(0);

    lien.versPc().ecrire(enc('c')); // écrit pendant la coupure : bufferisé, pas perdu

    // Rétablissement : l'horloge déclenche la tentative de reconnexion planifiée.
    horloge.declencherToutes();
    await Promise.resolve(); // laisse la promesse de connexion se résoudre

    expect(lien.etat()).toBe('ouvert');
    expect(lien.rattachements()).toBe(2); // connexion initiale + un rattachement
    expect(lien.remonteesTransitoires()).toBe(0);
    // Rejeu : a, b (jamais acquittés) et c, dans l'ordre, sur la nouvelle connexion.
    expect(websockets[1]!.envoyes.map((t) => decoderTrame(t).seq)).toEqual([0, 1, 2]);
  });

  test('critère (b) — kill(signal) atteint le processus distant, connecté', async () => {
    const ws = new FakeWebSocket();
    const lien = new LienWebSocket({ connecter: async () => ws });
    await lien.connecter();

    lien.envoyerKill('SIGTERM');

    const trameKill = ws.envoyes.map(decoderTrame).find((t) => t.tag === TAG.KILL);
    expect(trameKill).toBeDefined();
    expect(new TextDecoder().decode(trameKill!.payload)).toBe('SIGTERM');
  });

  test('critère (b) — kill demandé pendant une coupure atteint le processus au rattachement', async () => {
    const horloge = creerHorlogeManuelle();
    const websockets: FakeWebSocket[] = [];
    const lien = new LienWebSocket({
      horloge,
      connecter: async () => {
        const ws = new FakeWebSocket();
        websockets.push(ws);
        return ws;
      },
    });
    await lien.connecter();

    websockets[0]!.simulerFermeture(1006, '');
    lien.envoyerKill('SIGTERM'); // demandé pendant la coupure : mémorisé, pas perdu

    horloge.declencherToutes();
    await Promise.resolve();

    const trameKill = websockets[1]!.envoyes.map(decoderTrame).find((t) => t.tag === TAG.KILL);
    expect(trameKill).toBeDefined();
    expect(new TextDecoder().decode(trameKill!.payload)).toBe('SIGTERM');
  });

  test('critère (c) — stderr rapatrié, une erreur de hook y est visible', async () => {
    const ws = new FakeWebSocket();
    const lien = new LienWebSocket({ connecter: async () => ws });
    await lien.connecter();

    const recus: string[] = [];
    lien.surStderr((texte) => recus.push(texte));

    const messageHook = "PreToolUse hook 'garde-fou' a échoué : exit 1";
    ws.simulerMessage(encoderTrame(TAG.STDERR, 0, encoderTexte(messageHook)));

    expect(recus).toEqual([messageHook]);
  });

  test('fermeture terminale 4090 (epoch dépassé) : rattachement interdit, remontée immédiate', async () => {
    const ws = new FakeWebSocket();
    const lien = new LienWebSocket({ connecter: async () => ws });
    await lien.connecter();

    const fermetures: unknown[] = [];
    lien.surFermeture((f) => fermetures.push(f));
    ws.simulerFermeture(4090, '');

    expect(lien.etat()).toBe('ferme_terminal');
    expect(fermetures).toEqual([{ terminal: true, code: 4090, raison: 'epoch dépassé — plus le worker actif', rattachementAutorise: false }]);
  });

  test('notification EXIT distante traverse le lien intacte', async () => {
    const ws = new FakeWebSocket();
    const lien = new LienWebSocket({ connecter: async () => ws });
    await lien.connecter();

    const exits: Array<[number | null, string | null]> = [];
    lien.surExit((code, signal) => exits.push([code, signal]));
    ws.simulerMessage(encoderTrame(TAG.EXIT, 0, encoderExit({ code: 1, signal: null })));

    expect(exits).toEqual([[1, null]]);
  });

  test('ACK reçu purge le tampon de rejeu : un rattachement ne rejoue que le non-acquitté', async () => {
    const horloge = creerHorlogeManuelle();
    const websockets: FakeWebSocket[] = [];
    const lien = new LienWebSocket({
      horloge,
      connecter: async () => {
        const ws = new FakeWebSocket();
        websockets.push(ws);
        return ws;
      },
    });
    await lien.connecter();

    lien.versPc().ecrire(enc('a')); // seq 0
    websockets[0]!.simulerMessage(encoderTrame(TAG.ACK, 0, encoderTexte('0'))); // « a » acquitté
    lien.versPc().ecrire(enc('b')); // seq 1, jamais acquitté

    websockets[0]!.simulerFermeture(1006, '');
    horloge.declencherToutes();
    await Promise.resolve();

    // Seul « b » (seq 1) est rejoué ; « a » a été purgé du tampon par l'ACK.
    expect(websockets[1]!.envoyes.map((t) => decoderTrame(t).seq)).toEqual([1]);
  });
});

describe('LienWebSocket — vivacité applicative, dette de M-10 comblée (H-69)', () => {
  test('reçoit un PING (rôle du pair) : répond PONG immédiatement, sans passer par un agent', async () => {
    const ws = new FakeWebSocket();
    const lien = new LienWebSocket({ connecter: async () => ws });
    await lien.connecter();

    ws.simulerMessage(encoderTrame(TAG.PING, 0, new Uint8Array(0)));

    const pong = ws.envoyes.map(decoderTrame).find((t) => t.tag === TAG.PONG);
    expect(pong).toBeDefined();
  });

  test('lien idle : un tic de vivacité sonde le pair par PING, coût = une trame', async () => {
    const horloge = creerHorlogeManuelle();
    const ws = new FakeWebSocket();
    const lien = new LienWebSocket({ horloge, connecter: async () => ws, intervalePingMs: 5000, pingsManquesAvantMort: 3 });
    await lien.connecter();

    horloge.declencherToutes(); // un seul tic de vivacité en attente

    const pings = ws.envoyes.map(decoderTrame).filter((t) => t.tag === TAG.PING);
    expect(pings).toHaveLength(1);
  });

  test("mission active : tant qu'un trafic circule à chaque tic, aucun PING n'est jamais nécessaire", async () => {
    const horloge = creerHorlogeManuelle();
    const ws = new FakeWebSocket();
    const lien = new LienWebSocket({ horloge, connecter: async () => ws, intervalePingMs: 5000, pingsManquesAvantMort: 3 });
    await lien.connecter();

    // Le tic envoie tout de même une sonde (coût fixe, négligeable) — mais ce
    // qui compte pour la mission est qu'un flux réel (ici l'ACK que le pair
    // renvoie pour chaque écriture, comme en production) maintienne le
    // compteur de tics manqués à zéro et ne déclenche donc jamais de coupure.
    for (let i = 0; i < 5; i++) {
      lien.versPc().ecrire(enc(`tour-${i}`));
      ws.simulerMessage(encoderTrame(TAG.ACK, 0, encoderTexte(String(i))));
      horloge.declencherToutes();
    }

    expect(lien.etat()).toBe('ouvert');
    expect(lien.coupuresSilencieusesDetectees()).toBe(0);
  });

  test('agent qui réfléchit longtemps sans rien émettre : jamais confondu avec un tunnel mort tant que le pair répond', async () => {
    const horloge = creerHorlogeManuelle();
    const ws = new FakeWebSocket();
    const lien = new LienWebSocket({ horloge, connecter: async () => ws, intervalePingMs: 5000, pingsManquesAvantMort: 3 });
    await lien.connecter();

    // 10 tics consécutifs sans la moindre donnée applicative (aucun tour de
    // l'agent, aucun octet stdout) — mais le pair répond systématiquement au
    // ping, preuve que le lien est réellement vivant. Bien au-delà du seuil
    // de 3, le lien ne doit jamais être déclaré mort.
    for (let i = 0; i < 10; i++) {
      horloge.declencherToutes();
      const dernierPing = ws.envoyes.map(decoderTrame).filter((t) => t.tag === TAG.PING).at(-1);
      expect(dernierPing).toBeDefined();
      ws.simulerMessage(encoderTrame(TAG.PONG, dernierPing!.seq, new Uint8Array(0)));
    }

    expect(lien.etat()).toBe('ouvert');
    expect(lien.coupuresSilencieusesDetectees()).toBe(0);
  });

  test('un seul ping perdu ne déclenche rien : le compteur revient à zéro dès la moindre activité', async () => {
    const horloge = creerHorlogeManuelle();
    const ws = new FakeWebSocket();
    const lien = new LienWebSocket({ horloge, connecter: async () => ws, intervalePingMs: 5000, pingsManquesAvantMort: 3 });
    await lien.connecter();

    horloge.declencherToutes(); // tic 1 : rien ne répond — un « manqué »
    horloge.declencherToutes(); // tic 2 : toujours rien — deux « manqués », sous le seuil de 3

    // Un octet arrive enfin (STDOUT distant, ou tout autre tag) : preuve de vie.
    ws.simulerMessage(encoderTrame(TAG.STDOUT, 0, enc('x')));

    horloge.declencherToutes(); // tic 3 : ne compte pas comme un 3ème manqué
    horloge.declencherToutes(); // tic 4
    horloge.declencherToutes(); // tic 5 — jamais 3 manqués *consécutifs*

    expect(lien.etat()).toBe('ouvert');
    expect(lien.coupuresSilencieusesDetectees()).toBe(0);
  });

  test(
    "coupure silencieuse (ni close ni error, le socket reste 'ouvert') : détectée au seuil, " +
      'même chemin de reprise (backoff, rattachement, rejeu) qu\'une coupure signalée',
    async () => {
      const horloge = creerHorlogeManuelle();
      const websockets: FakeWebSocket[] = [];
      const lien = new LienWebSocket({
        horloge,
        connecter: async () => {
          const ws = new FakeWebSocket();
          websockets.push(ws);
          return ws;
        },
        intervalePingMs: 5000,
        pingsManquesAvantMort: 3,
      });
      await lien.connecter();

      lien.versPc().ecrire(enc('a')); // jamais acquittée : doit survivre à la reprise

      // Le pair ne répond plus jamais — silence total, mais `readyState` reste
      // « ouvert » : ni `close` ni `error` ne se déclenchent (c'est la panne
      // par définition indiscernable d'un agent qui réfléchit).
      horloge.declencherToutes(); // tic 1 : manqué
      expect(lien.etat()).toBe('ouvert');
      horloge.declencherToutes(); // tic 2 : manqué
      expect(lien.etat()).toBe('ouvert');
      expect(lien.coupuresSilencieusesDetectees()).toBe(0);

      horloge.declencherToutes(); // tic 3 : seuil atteint, coupure déclarée

      expect(lien.etat()).toBe('coupe_transitoire');
      expect(lien.coupuresSilencieusesDetectees()).toBe(1);
      // D.2.1 : le transitoire — signalé ou silencieux — n'est jamais remonté.
      expect(lien.remonteesTransitoires()).toBe(0);

      // Chemin de reprise partagé : le backoff planifié se déclenche comme
      // pour n'importe quelle coupure transitoire.
      horloge.declencherToutes();
      await Promise.resolve();

      expect(lien.etat()).toBe('ouvert');
      expect(lien.rattachements()).toBe(2); // connexion initiale + un rattachement
      // Rejeu du non-acquitté sur la nouvelle connexion, comme D.2.2 l'exige.
      expect(websockets[1]!.envoyes.map((t) => decoderTrame(t).seq)).toContain(0);
    },
  );

  test('seuil configurable : pingsManquesAvantMort=1 détecte dès le premier silence', async () => {
    const horloge = creerHorlogeManuelle();
    const ws = new FakeWebSocket();
    const lien = new LienWebSocket({ horloge, connecter: async () => ws, intervalePingMs: 1000, pingsManquesAvantMort: 1 });
    await lien.connecter();

    horloge.declencherToutes();

    expect(lien.etat()).toBe('coupe_transitoire');
    expect(lien.coupuresSilencieusesDetectees()).toBe(1);
  });

  test('intervalePingMs <= 0 : opt-out explicite, aucun ping envoyé, aucune fausse détection', async () => {
    const horloge = creerHorlogeManuelle();
    const ws = new FakeWebSocket();
    const lien = new LienWebSocket({ horloge, connecter: async () => ws, intervalePingMs: 0 });
    await lien.connecter();

    // Rien n'est planifié : déclencher l'horloge ne fait rien, le lien reste sain.
    horloge.declencherToutes();

    expect(ws.envoyes.map(decoderTrame).some((t) => t.tag === TAG.PING)).toBe(false);
    expect(lien.etat()).toBe('ouvert');
    expect(lien.coupuresSilencieusesDetectees()).toBe(0);
  });
});
