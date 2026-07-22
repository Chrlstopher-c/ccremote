/**
 * Tests du principe directeur de M-31 : une divergence miroir/vérité ne se dissout
 * jamais en silence. Couvre `session_defaillance` (trace indépendante du flux SDK),
 * `etatMiroir` (surface d'observation), le mtime du sommaire (panne #31, jamais dérivé
 * des horodatages d'entrées) et la concurrence sur le pli (H.3.2).
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { SessionKey, SessionStoreEntry } from '@anthropic-ai/claude-agent-sdk';
import { ouvrirSessionStore, type Horloge, type SessionStoreSqlite } from './index.ts';

const CLE: SessionKey = { projectKey: 'projet-a', sessionId: 'session-1' };

function horlogeFixe(valeurs: number[]): Horloge {
  let i = 0;
  return { maintenant: () => valeurs[Math.min(i++, valeurs.length - 1)] ?? 0 };
}

function entree(type: string, extra: Record<string, unknown> = {}): SessionStoreEntry {
  return { type, ...extra };
}

// ------------------------------------------------------- défaillance détectable

describe('défaillance d append — divergence détectable (principe directeur)', () => {
  let contexte: ReturnType<typeof ouvrirSessionStore>;
  let store: SessionStoreSqlite;

  beforeEach(() => {
    contexte = ouvrirSessionStore({ chemin: ':memory:' });
    store = contexte.store;
  });

  afterEach(() => {
    contexte.fermer();
  });

  test('un échec d écriture est propagé (jamais avalé) et laisse une trace durable', async () => {
    // Entrée délibérément malformée : `type` absent viole la contrainte NOT NULL de la
    // colonne — un échec de stockage réel et reproductible, pas un mock de complaisance.
    const malformee = JSON.parse('{"uuid":"boom"}') as SessionStoreEntry;

    await expect(store.append(CLE, [malformee])).rejects.toThrow();

    const etat = store.etatMiroir(CLE);
    expect(etat.divergent).toBe(true);
    expect(etat.defaillances).toHaveLength(1);
    expect(etat.defaillances[0]?.sessionId).toBe('session-1');
  });

  test('une session saine reste non-divergente', () => {
    const etat = store.etatMiroir(CLE);
    expect(etat.divergent).toBe(false);
    expect(etat.defaillances).toEqual([]);
  });

  test('un échec sur un lot n empêche pas les lots suivants de réussir (sous-processus inaffecté)', async () => {
    const malformee = JSON.parse('{"uuid":"boom"}') as SessionStoreEntry;
    await expect(store.append(CLE, [malformee])).rejects.toThrow();

    await store.append(CLE, [entree('user', { uuid: 'u-1' })]);
    const relues = await store.load(CLE);
    expect(relues).toHaveLength(1);
  });
});

// --------------------------------------------------------------------- mtime

describe('mtime du sommaire (panne #31 de la grille)', () => {
  test('mtime vient de l horloge du store, jamais des horodatages d entrées', async () => {
    const contexte = ouvrirSessionStore({ chemin: ':memory:' }, horlogeFixe([777_000]));
    const store = contexte.store;
    // Horodatage d'entrée volontairement très ancien, pour prouver qu'il n'influence rien.
    await store.append(CLE, [entree('user', { uuid: 'u-1', timestamp: '2001-01-01T00:00:00.000Z' })]);
    const sessions = await store.listSessions(CLE.projectKey);
    expect(sessions[0]?.mtime).toBe(777_000);
    contexte.fermer();
  });

  test('deux écritures dans la même milliseconde produisent un mtime strictement croissant', async () => {
    const contexte = ouvrirSessionStore({ chemin: ':memory:' }, horlogeFixe([1000, 1000]));
    const store = contexte.store;
    await store.append(CLE, [entree('user', { uuid: 'u-1' })]);
    const premier = (await store.listSessions(CLE.projectKey))[0]?.mtime;
    await store.append(CLE, [entree('user', { uuid: 'u-2' })]);
    const second = (await store.listSessions(CLE.projectKey))[0]?.mtime;
    expect(second).toBeGreaterThan(premier ?? -1);
    contexte.fermer();
  });
});

// ---------------------------------------------------------------- concurrence

describe('concurrence sur le pli (H.3.2 : « concurrency control is the store’s responsibility »)', () => {
  test('deux append concurrents sur la même session ne perdent aucune entrée', async () => {
    const contexte = ouvrirSessionStore({ chemin: ':memory:' });
    const store = contexte.store;

    await Promise.all([
      store.append(CLE, [entree('user', { uuid: 'u-1' })]),
      store.append(CLE, [entree('assistant', { uuid: 'u-2' })]),
    ]);

    const relues = await store.load(CLE);
    expect(relues).toHaveLength(2);
    const uuids = new Set(relues?.map((e) => e['uuid']));
    expect(uuids).toEqual(new Set(['u-1', 'u-2']));
    contexte.fermer();
  });

  test('deux plis concurrents sur le sommaire n en perdent aucun (dernier-gagne cohérent)', async () => {
    const contexte = ouvrirSessionStore({ chemin: ':memory:' });
    const store = contexte.store;

    await Promise.all([
      store.append(CLE, [entree('user', { uuid: 'u-1', gitBranch: 'feature-a' })]),
      store.append(CLE, [entree('tag', { uuid: 'u-2', tag: 'important' })]),
    ]);

    const [sommaire] = await store.listSessionSummaries(CLE.projectKey);
    expect(sommaire?.data['gitBranch']).toBe('feature-a');
    expect(sommaire?.data['tag']).toBe('important');
    contexte.fermer();
  });
});
