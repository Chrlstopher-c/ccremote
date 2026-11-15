// Responsabilité : tests de la source de démonstration — évolution déterministe sur horloge injectée, sans réseau.
/// <reference types="bun" />
import { describe, expect, test } from 'bun:test';
import type { MessageClient, ResumeSession } from './contrat';
import { CYCLE_DEMO_MS } from './demo-scenario';
import { messagesEntre } from './demo-simulation';
import { creerSourceDemo } from './demo';
import { etatAgent } from './etat-agent';
import { MagasinMonde } from './monde-etat';
import { projetsDuMonde, sessionParId } from './monde-selecteurs';

const T0 = Date.parse('2026-11-15T10:00:00.000Z');
const SECONDE = 1000;

function horloge(depart: number): { lire: () => number; avancer: (ms: number) => void } {
  let t = depart;
  return { lire: () => t, avancer: (ms) => (t += ms) };
}

// L'origine du scénario est l'instant de création de la source : on la crée à T0, puis on avance l'horloge.
async function sessionALInstant(decalageMs: number, id: string): Promise<ResumeSession | undefined> {
  let maintenant = T0;
  const source = creerSourceDemo({ horloge: () => maintenant });
  maintenant = T0 + decalageMs;
  const etat = await source.etatInitial();
  return etat.sessions.find((s) => s.id === id);
}

describe('demo : état initial', () => {
  test('cinq sessions, deux machines et quatre projets distincts', async () => {
    const source = creerSourceDemo({ horloge: () => T0 });
    const etat = await source.etatInitial();
    expect(etat.sessions.length).toBe(5);
    expect(etat.machines.length).toBe(2);
    const magasin = new MagasinMonde();
    magasin.initialiser(etat);
    expect(new Set(projetsDuMonde(magasin.lire()).map((p) => p.projet.chemin)).size).toBe(4);
  });

  test('la session demo-4 est inactive dès le départ, la demo-5 est en erreur au départ', async () => {
    const inactive = await sessionALInstant(0, 'demo-4');
    expect(inactive && etatAgent(inactive, T0)).toBe('inactive');
    const erreur = await sessionALInstant(0, 'demo-5');
    expect(erreur && etatAgent(erreur, T0)).toBe('erreur');
  });
});

describe('demo : évolution déterministe', () => {
  test('la session demo-1 passe de travail à fini puis à inactif', async () => {
    const etatA = async (decalage: number): Promise<string | undefined> => {
      const s = await sessionALInstant(decalage, 'demo-1');
      return s ? etatAgent(s, T0 + decalage) : undefined;
    };
    expect(await etatA(0)).toBe('travail');
    expect(await etatA(130 * SECONDE)).toBe('fini');
    expect(await etatA(175 * SECONDE)).toBe('inactive');
  });

  test('la question de demo-3 bloque l agent et ne notifie qu une fois par cycle', () => {
    const messages = messagesEntre(T0, T0, T0 + CYCLE_DEMO_MS);
    expect(messages.filter((m) => m.type === 'notification').length).toBe(1);
    const bloque = messages.some(
      (m) => m.type === 'session' && m.session.id === 'demo-3' && m.session.statut === 'question',
    );
    expect(bloque).toBe(true);
  });

  test('deux calculs sur les mêmes instants donnent exactement les mêmes messages', () => {
    const a: MessageClient[] = messagesEntre(T0, T0, T0 + CYCLE_DEMO_MS * 2);
    const b: MessageClient[] = messagesEntre(T0, T0, T0 + CYCLE_DEMO_MS * 2);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe('demo : flux émis par la source', () => {
  test('chaque événement n est émis qu une fois, même sur plusieurs cycles', () => {
    const { lire, avancer } = horloge(T0);
    const planif: { tick: (() => void) | null } = { tick: null };
    const recus: MessageClient[] = [];
    const source = creerSourceDemo({
      horloge: lire,
      planifier: (fn) => {
        planif.tick = fn;
        return () => {
          planif.tick = null;
        };
      },
    });
    source.demarrer({ surLien: () => undefined, surMessage: (m) => recus.push(m) });
    for (let i = 0; i < (2 * CYCLE_DEMO_MS) / SECONDE + 5; i += 1) {
      avancer(SECONDE);
      planif.tick?.();
    }
    const cles = recus.flatMap((m) => (m.type === 'evenement' ? [`${m.evenement.sessionId}:${m.evenement.seq}`] : []));
    expect(cles.length).toBeGreaterThan(0);
    expect(new Set(cles).size).toBe(cles.length);
  });

  test('le fil d une session est trié, borné et ne mélange pas les sessions', async () => {
    const source = creerSourceDemo({ horloge: () => T0 });
    const fil = await source.evenements('demo-1');
    expect(fil.length).toBeGreaterThan(0);
    expect(fil.length).toBeLessThanOrEqual(300);
    expect(fil.every((e) => e.sessionId === 'demo-1')).toBe(true);
    const seqs = fil.map((e) => e.seq);
    expect(seqs).toEqual([...seqs].sort((x, y) => x - y));
  });

  test('les actions sont acceptées sans effet réseau', async () => {
    const source = creerSourceDemo({ horloge: () => T0 });
    await expect(source.api.envoyerMessage('demo-1', 'salut')).resolves.toBeUndefined();
    await expect(source.api.agir('demo-1', 'archiver')).resolves.toBeUndefined();
  });

  test('le magasin alimenté par la démo retrouve la session par id', async () => {
    const source = creerSourceDemo({ horloge: () => T0 });
    const magasin = new MagasinMonde();
    magasin.initialiser(await source.etatInitial());
    expect(sessionParId(magasin.lire(), 'demo-2')?.projet.nom).toBe('stockiop');
  });
});
