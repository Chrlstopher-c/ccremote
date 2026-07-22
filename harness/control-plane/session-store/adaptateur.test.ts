/**
 * Tests du contrat `SessionStore` réel (E.3, mission M-31) : idempotence (E.3.2),
 * ordre d'appel (E.3.1), sous-clés et suppression (pannes #4 et #8), schéma.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { Options, SessionKey, SessionStoreEntry } from '@anthropic-ai/claude-agent-sdk';
import { ouvrirSessionStore, VERSION_SCHEMA_ATTENDUE, type SessionStoreSqlite } from './index.ts';

let contexte: ReturnType<typeof ouvrirSessionStore>;
let store: SessionStoreSqlite;

/**
 * Vérification de compilation, jamais exécutée : `SessionStoreSqlite` doit rester
 * assignable à `Options['sessionStore']`, le point exact où `WorkerSpec.sessionStore`
 * (branche B, `workers/types.ts`) le branchera au spawn d'un worker.
 */
function _assignableAWorkerSpec(s: SessionStoreSqlite): Options['sessionStore'] {
  return s;
}
void _assignableAWorkerSpec;

const CLE: SessionKey = { projectKey: 'projet-a', sessionId: 'session-1' };

beforeEach(() => {
  contexte = ouvrirSessionStore({ chemin: ':memory:' });
  store = contexte.store;
});

afterEach(() => {
  contexte.fermer();
});

function entree(type: string, extra: Record<string, unknown> = {}): SessionStoreEntry {
  return { type, timestamp: '2026-07-22T10:00:00.000Z', ...extra };
}

// ---------------------------------------------------------------- schéma

describe('schéma', () => {
  test('migre à la version cible à l ouverture', () => {
    expect(contexte.version()).toBe(VERSION_SCHEMA_ATTENDUE);
  });
});

// ---------------------------------------------------------- append / load

describe('append / load', () => {
  test('round-trip : ce qui est ajouté est relu, deep-equal', async () => {
    const e = entree('user', { uuid: 'u-1', message: { role: 'user', content: 'salut' } });
    await store.append(CLE, [e]);
    const relues = await store.load(CLE);
    expect(relues).toEqual([e]);
  });

  test('clé jamais écrite ⇒ null', async () => {
    const relues = await store.load({ projectKey: 'jamais', sessionId: 'vu' });
    expect(relues).toBeNull();
  });

  test('préserve l ordre d appel dans un même processus (E.3.1)', async () => {
    await store.append(CLE, [entree('user', { uuid: 'u-1' }), entree('assistant', { uuid: 'u-2' })]);
    await store.append(CLE, [entree('assistant', { uuid: 'u-3' })]);
    const relues = await store.load(CLE);
    expect(relues?.map((e) => e['uuid'])).toEqual(['u-1', 'u-2', 'u-3']);
  });
});

// -------------------------------------------------------------- idempotence

describe('idempotence par uuid (E.3.2)', () => {
  test('un uuid répété met à jour en place, sans dupliquer', async () => {
    await store.append(CLE, [entree('user', { uuid: 'u-1', content: 'v1' })]);
    await store.append(CLE, [entree('user', { uuid: 'u-1', content: 'v2' })]);
    const relues = await store.load(CLE);
    expect(relues).toHaveLength(1);
    expect(relues?.[0]?.['content']).toBe('v2');
  });

  test('la mise à jour préserve la position d origine (pas de réordonnancement)', async () => {
    await store.append(CLE, [
      entree('user', { uuid: 'u-1' }),
      entree('assistant', { uuid: 'u-2' }),
      entree('assistant', { uuid: 'u-3' }),
    ]);
    await store.append(CLE, [entree('user', { uuid: 'u-1', revise: true })]);
    const relues = await store.load(CLE);
    expect(relues?.map((e) => e['uuid'])).toEqual(['u-1', 'u-2', 'u-3']);
    expect(relues?.[0]?.['revise']).toBe(true);
  });

  test('sans uuid : jamais dédupliqué, chaque appel ajoute une ligne', async () => {
    const marqueur = entree('mode_marker', { mode: 'plan' });
    await store.append(CLE, [marqueur]);
    await store.append(CLE, [marqueur]);
    const relues = await store.load(CLE);
    expect(relues).toHaveLength(2);
  });
});

// ------------------------------------------------------------ sous-clés

describe('sous-clés de sous-agents (panne #4)', () => {
  test('listSubkeys retourne les sous-chemins écrits', async () => {
    const cleSousAgent: SessionKey = { ...CLE, subpath: 'subagents/agent-abc' };
    await store.append(cleSousAgent, [entree('assistant', { uuid: 'sa-1' })]);
    const sousCles = await store.listSubkeys({ projectKey: CLE.projectKey, sessionId: CLE.sessionId });
    expect(sousCles).toEqual(['subagents/agent-abc']);
  });

  test('un transcript de sous-agent ne produit pas de sommaire (aligné sur la référence SDK)', async () => {
    const cleSousAgent: SessionKey = { ...CLE, subpath: 'subagents/agent-abc' };
    await store.append(cleSousAgent, [entree('assistant', { uuid: 'sa-1' })]);
    const sessions = await store.listSessions(CLE.projectKey);
    expect(sessions).toEqual([]);
  });

  test('subpath vide ("") est rejeté — invalide selon le contrat SDK', async () => {
    await expect(store.append({ ...CLE, subpath: '' }, [entree('user')])).rejects.toThrow();
  });
});

// ------------------------------------------------------------- suppression

describe('suppression (panne #8)', () => {
  test('delete supprime réellement les entrées et le sommaire', async () => {
    await store.append(CLE, [entree('user', { uuid: 'u-1' })]);
    await store.delete(CLE);
    expect(await store.load(CLE)).toBeNull();
    expect(await store.listSessions(CLE.projectKey)).toEqual([]);
  });

  test('supprimer un sous-chemin laisse le transcript principal intact', async () => {
    const cleSousAgent: SessionKey = { ...CLE, subpath: 'subagents/agent-abc' };
    await store.append(CLE, [entree('user', { uuid: 'u-1' })]);
    await store.append(cleSousAgent, [entree('assistant', { uuid: 'sa-1' })]);
    await store.delete(cleSousAgent);
    expect(await store.load(CLE)).toHaveLength(1);
    expect(await store.listSubkeys({ projectKey: CLE.projectKey, sessionId: CLE.sessionId })).toEqual([]);
  });
});

// ------------------------------------------------------------- listSessions

describe('listSessions / listSessionSummaries', () => {
  test('une session avec transcript principal apparaît dans les deux', async () => {
    await store.append(CLE, [entree('user', { uuid: 'u-1' })]);
    const sessions = await store.listSessions(CLE.projectKey);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.sessionId).toBe('session-1');

    const sommaires = await store.listSessionSummaries(CLE.projectKey);
    expect(sommaires).toHaveLength(1);
    expect(sommaires[0]?.sessionId).toBe('session-1');
  });

  test('le blob data du sommaire est relayé verbatim, jamais interprété', async () => {
    await store.append(CLE, [entree('user', { uuid: 'u-1', cwd: '/mnt/projets/alpha' })]);
    const [sommaire] = await store.listSessionSummaries(CLE.projectKey);
    // champ posé par foldSessionSummary lui-même (⚠ ALPHA, opaque) — on vérifie seulement
    // qu'il traverse le store sans altération, pas qu'on en connaît la forme complète.
    expect(sommaire?.data['cwd']).toBe('/mnt/projets/alpha');
  });
});
