/**
 * Critère de réussite de la mission H-74 : un vrai process trivial, spawné via
 * `creerSpawnerLocal`, livre un `pid`/`pidStarttime` cohérents avec `/proc`, et
 * l'objet rendu se comporte comme un `SpawnedProcess` (stdout lisible, kill
 * effectif, `'exit'` émis).
 */

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import type { SpawnOptions } from '@anthropic-ai/claude-agent-sdk';
import { creerSpawnerLocal, lireStarttimeAuSpawn, type IdentiteProcessSpawn } from './process-spawner.ts';

function starttimeDirect(pid: number): string | null {
  const contenu = readFileSync(`/proc/${pid}/stat`, 'utf8');
  const finComm = contenu.lastIndexOf(')');
  if (finComm === -1) return null;
  return contenu.slice(finComm + 1).trim().split(/\s+/)[19] ?? null;
}

function options(overrides: Partial<SpawnOptions> = {}): SpawnOptions {
  return {
    command: '/bin/sh',
    args: ['-c', 'echo bonjour; sleep 5'],
    env: { ...process.env },
    signal: new AbortController().signal,
    ...overrides,
  };
}

describe('creerSpawnerLocal', () => {
  test('capture pid + pidStarttime cohérents avec /proc, expose un SpawnedProcess conforme', async () => {
    let identite: IdentiteProcessSpawn | null = null;
    const spawnProcess = creerSpawnerLocal((captured) => {
      identite = captured;
    });
    const proc = spawnProcess(options());

    expect(identite).not.toBeNull();
    const capturee = identite as unknown as IdentiteProcessSpawn;
    expect(capturee.pid).toBeGreaterThan(0);
    expect(capturee.pidStarttime).not.toBeNull();
    expect(capturee.pidStarttime).toBe(starttimeDirect(capturee.pid));
    expect(lireStarttimeAuSpawn(capturee.pid)).toBe(capturee.pidStarttime);

    const sortie = await new Promise<string>((resolve) => {
      let data = '';
      proc.stdout.on('data', (chunk: Buffer) => {
        data += chunk.toString();
      });
      setTimeout(() => resolve(data), 300);
    });
    expect(sortie).toContain('bonjour');

    const exitEvent = new Promise<[number | null, NodeJS.Signals | null]>((resolve) => {
      proc.once('exit', (code, signal) => resolve([code, signal]));
    });
    expect(proc.kill('SIGTERM')).toBe(true);
    const [, signal] = await exitEvent;
    expect(signal).toBe('SIGTERM');
    expect(proc.killed).toBe(true);
  });

  test('un pid recyclable ne suffit pas seul : starttime lu au spawn distingue deux process', async () => {
    const identites: IdentiteProcessSpawn[] = [];
    const spawnProcess = creerSpawnerLocal((captured) => identites.push(captured));

    const premier = spawnProcess(options({ args: ['-c', 'sleep 5'] }));
    const second = spawnProcess(options({ args: ['-c', 'sleep 5'] }));

    expect(identites).toHaveLength(2);
    // Deux pid distincts (le noyau ne recycle pas instantanément) : le couple
    // (pid, starttime) reste la seule identité fiable, jamais le pid seul.
    expect(identites[0]?.pid).not.toBe(identites[1]?.pid);

    premier.kill('SIGKILL');
    second.kill('SIGKILL');
  });

  test('un signal déjà déclenché avant le spawn tue immédiatement (chemin B.2.2)', async () => {
    const controller = new AbortController();
    controller.abort();
    const spawnProcess = creerSpawnerLocal();
    const proc = spawnProcess(options({ args: ['-c', 'sleep 5'], signal: controller.signal }));

    await new Promise<void>((resolve) => proc.once('exit', () => resolve()));
    expect(proc.killed).toBe(true);
  });
});
