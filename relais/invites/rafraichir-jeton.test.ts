// Tests du rafraîchissement du jeton OAuth par un Claude Code minimal : un seul à la fois, délai borné, échec propre.
import { describe, expect, test } from 'bun:test';
import pino from 'pino';
import { RafraichisseurJeton } from './rafraichir-jeton.ts';

const journal = pino({ enabled: false });

describe('rafraîchissement du jeton du chef', () => {
  test('appels simultanés : un seul Claude Code lancé, tous reçoivent son issue', async () => {
    let lances = 0;
    let finir: (code: number) => void = () => undefined;
    const r = new RafraichisseurJeton({
      journal,
      delaiMs: 1000,
      lancer: () => {
        lances += 1;
        return { fini: new Promise<number>((ok) => (finir = ok)), arreter: () => undefined };
      },
    });
    const a = r.rafraichir();
    const b = r.rafraichir();
    finir(0);
    expect(await a).toBe(true);
    expect(await b).toBe(true);
    expect(lances).toBe(1);
  });

  test('code de sortie non nul : échec', async () => {
    const r = new RafraichisseurJeton({
      journal,
      delaiMs: 1000,
      lancer: () => ({ fini: Promise.resolve(1), arreter: () => undefined }),
    });
    expect(await r.rafraichir()).toBe(false);
  });

  test('délai dépassé : le processus est arrêté, échec', async () => {
    let arrete = false;
    const r = new RafraichisseurJeton({
      journal,
      delaiMs: 20,
      lancer: () => ({ fini: new Promise<number>(() => undefined), arreter: () => (arrete = true) }),
    });
    expect(await r.rafraichir()).toBe(false);
    expect(arrete).toBe(true);
  });

  test('lancement impossible (claude absent) : échec sans exception', async () => {
    const r = new RafraichisseurJeton({
      journal,
      delaiMs: 100,
      lancer: () => {
        throw new Error('claude introuvable');
      },
    });
    expect(await r.rafraichir()).toBe(false);
  });
});
