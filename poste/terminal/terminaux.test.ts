import { describe, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import pino from 'pino';
import { commandeDe, Terminaux } from './terminaux.ts';

const journal = pino({ level: 'silent' });

function attendre(condition: () => boolean, delaiMs = 5_000): Promise<void> {
  const fin = Date.now() + delaiMs;
  return new Promise((ok, ko) => {
    const verifier = () =>
      condition() ? ok() : Date.now() > fin ? ko(new Error('délai dépassé')) : setTimeout(verifier, 20);
    verifier();
  });
}

describe('terminaux à distance', () => {
  test('une session Claude s’ouvre en client tmux attaché, jamais en créant une session', () => {
    expect(commandeDe({ type: 'tmux', tmux: 'claude-x' })).toEqual([
      'tmux',
      '-L',
      'claude',
      '-u',
      'attach',
      '-t',
      '=claude-x',
    ]);
  });

  test('un shell : la frappe entre, la sortie ressort, la fin est signalée', async () => {
    let sortie = '';
    let fin: number | null | undefined;
    const t = new Terminaux(
      { sortie: (_id, b64) => (sortie += Buffer.from(b64, 'base64').toString()), fin: (_id, code) => (fin = code) },
      journal,
    );
    const id = randomUUID();
    process.env['SHELL'] = '/bin/sh';
    expect(t.ouvrir(id, { type: 'shell', dossier: '/tmp' }, 80, 24).ok).toBe(true);
    t.entree(id, Buffer.from('echo "quart-$((6*7))"; pwd\n').toString('base64'));
    await attendre(() => sortie.includes('quart-42') && sortie.includes('/tmp'));
    t.taille(id, 120, 40);
    t.entree(id, Buffer.from('exit 3\n').toString('base64'));
    await attendre(() => fin !== undefined);
    expect(fin).toBe(3);
  });

  test('fermer un terminal le termine', async () => {
    let fini = false;
    const t = new Terminaux({ sortie: () => undefined, fin: () => (fini = true) }, journal);
    const id = randomUUID();
    t.ouvrir(id, { type: 'shell' }, 80, 24);
    t.fermer(id);
    await attendre(() => fini);
  });
});
