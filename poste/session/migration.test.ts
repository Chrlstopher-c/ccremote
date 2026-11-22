import { describe, expect, test } from 'bun:test';
import type { forkSession } from '@anthropic-ai/claude-agent-sdk';
import type { Evenement } from '../../commun/session.ts';
import type { TranscriptDecouvert } from './decouverte.ts';
import { journal, nouvelleSession } from './faux-sdk.ts';
import { type DependancesMigration, migrer } from './migration.ts';

const COPIE: TranscriptDecouvert = {
  id: 'copie-1',
  cwd: '/projets/app',
  chemin: '/tmp/fictif.jsonl',
  configDir: null,
  titre: 'Titre',
  modifieLe: '2026-11-22T10:00:00.000Z',
  machine: 'tour',
  branche: null,
  messages: 3,
};

const OBSERVEE = { terminal: true, pilotee: false, titre: 'Titre', effort: null, mode: 'default' as const };

function deps(options: { fork?: 'echec'; trouve?: boolean; resume?: Record<string, unknown> } = {}) {
  const session = nouvelleSession(async () => [{ type: 'result' }], {
    resume: { ...OBSERVEE, ...options.resume },
  });
  const forks: { id: string; options: unknown }[] = [];
  const importes: { surcharge: Record<string, unknown> }[] = [];
  const evenements: { id: string; evt: Evenement }[] = [];
  let sauvegardes = 0;
  const fork = (async (id: string, opts: unknown) => {
    forks.push({ id, options: opts });
    if (options.fork === 'echec') throw new Error('SDK indisponible');
    return { sessionId: 'copie-1' };
  }) as unknown as typeof forkSession;
  const d: DependancesMigration = {
    sessions: new Map([['source', session.session]]),
    journal,
    trouverImportables: () => (options.trouve === false ? [] : [COPIE]),
    importerUne: (_t, surcharge) => importes.push({ surcharge: surcharge as Record<string, unknown> }),
    sauvegarder: () => {
      sauvegardes += 1;
    },
    evenement: (id, evt) => evenements.push({ id, evt }),
    fork,
  };
  return { d, forks, importes, evenements, sauvegardes: () => sauvegardes };
}

describe('migration vers Lanterne', () => {
  test('fork de la conversation, copie reprenable pilotée, événements des deux côtés, source intacte', async () => {
    const t = deps();
    const r = await migrer(t.d, 'source');
    expect(r).toEqual({ ok: true, donnees: { nouvelleSession: 'copie-1' } });
    expect(t.forks[0]).toEqual({ id: 'claude-abc', options: { dir: expect.any(String) } });
    expect(t.importes[0]?.surcharge).toEqual({ titre: 'Titre', modele: expect.any(String), effort: null, mode: 'default', pilotee: true });
    expect(t.evenements.map((e) => [e.id, e.evt.type])).toEqual([
      ['source', 'migration'],
      ['copie-1', 'migration'],
    ]);
    expect(t.sauvegardes()).toBe(1);
  });

  test('session pilotée par Lanterne : refusée, aucun fork', async () => {
    const t = deps({ resume: { pilotee: true } });
    const r = await migrer(t.d, 'source');
    expect(r.ok).toBe(false);
    expect(t.forks).toHaveLength(0);
  });

  test('SDK en échec ou copie introuvable : refus propre, rien d’importé', async () => {
    const echec = deps({ fork: 'echec' });
    expect((await migrer(echec.d, 'source')).ok).toBe(false);
    expect(echec.importes).toHaveLength(0);
    const absente = deps({ trouve: false });
    expect((await migrer(absente.d, 'source')).ok).toBe(false);
    expect(absente.importes).toHaveLength(0);
  });
});
