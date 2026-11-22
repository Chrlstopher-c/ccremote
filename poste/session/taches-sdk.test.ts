import { describe, expect, test } from 'bun:test';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { RegistreTaches } from './taches-sdk.ts';

const HORLOGE = Date.parse('2026-11-18T10:00:00.000Z');
const registre = () => new RegistreTaches(() => new Date(HORLOGE));
const message = (m: Record<string, unknown>): SDKMessage => m as unknown as SDKMessage; // forme partielle du SDK

const appelAgent = (modele: string | undefined): SDKMessage =>
  message({
    type: 'assistant',
    parent_tool_use_id: null,
    message: { content: [{ type: 'tool_use', id: 'toolu_a', name: 'Agent', input: { description: 'lire', model: modele } }] },
  });

const demarrage = (extra: Record<string, unknown> = {}): SDKMessage =>
  message({
    type: 'system',
    subtype: 'task_started',
    task_id: 'tache-1',
    tool_use_id: 'toolu_a',
    description: 'Lire le dépôt',
    task_type: 'local_agent',
    subagent_type: 'Explore',
    is_backgrounded: true,
    prompt: 'Lis le dépôt et résume-le',
    ...extra,
  });

describe('sous-agents encore en cours', () => {
  test('compte les sous-agents vivants, ni les terminés ni les commandes de fond', () => {
    const r = registre();
    r.observer(demarrage());
    const commande = { task_id: 'tache-2', tool_use_id: 'toolu_b', task_type: 'local_bash', subagent_type: undefined };
    r.observer(demarrage(commande));
    expect(r.sousAgentsEnCours()).toBe(1);
    r.observer(message({ type: 'system', subtype: 'task_notification', task_id: 'tache-1', status: 'completed' }));
    expect(r.sousAgentsEnCours()).toBe(0);
  });
});

describe('RegistreTaches', () => {
  test('une tâche de fond : démarrage avec son modèle, activité, fin par notification', () => {
    const r = registre();
    r.observer(appelAgent('claude-haiku-5-5'));
    r.observer(demarrage());
    r.observer(
      message({
        type: 'system',
        subtype: 'task_progress',
        task_id: 'tache-1',
        description: 'Lire le dépôt',
        usage: { total_tokens: 900, tool_uses: 3, duration_ms: 1200 },
        last_tool_name: 'Read',
      }),
    );
    expect(r.liste()).toEqual([
      {
        id: 'tache-1',
        type: 'local_agent',
        description: 'Lire le dépôt',
        statut: 'en_cours',
        arrierePlan: true,
        sousAgent: 'Explore',
        modele: 'claude-haiku-5-5',
        parent: null,
        activite: 'Read',
        outils: 3,
        jetons: 900,
        dureeMs: 1200,
        debutLe: '2026-11-18T10:00:00.000Z',
        finLe: null,
      },
    ]);
    r.observer(
      message({
        type: 'system',
        subtype: 'task_notification',
        task_id: 'tache-1',
        status: 'completed',
        summary: 'Dépôt lu',
        output_file: '/x',
        usage: { total_tokens: 1500, tool_uses: 4, duration_ms: 2000 },
      }),
    );
    const fin = r.detail('tache-1');
    expect(fin?.statut).toBe('terminee');
    expect(fin?.activite).toBeNull();
    expect(fin?.finLe).toBe('2026-11-18T10:00:00.000Z');
    expect(fin?.jetons).toBe(1500);
    expect(fin?.prompt).toBe('Lis le dépôt et résume-le');
    expect(r.liste()[0]).not.toHaveProperty('prompt');
  });

  test('sans appel de sous-agent connu, le modèle reste absent ; une mise à jour change le statut', () => {
    const r = registre();
    r.observer(demarrage({ is_backgrounded: false }));
    expect(r.detail('tache-1')?.modele).toBeNull();
    expect(r.detail('tache-1')?.arrierePlan).toBe(false);
    r.observer(message({ type: 'system', subtype: 'task_updated', task_id: 'tache-1', patch: { status: 'paused' } }));
    expect(r.detail('tache-1')?.statut).toBe('pausee');
    r.observer(message({ type: 'system', subtype: 'task_updated', task_id: 'tache-1', patch: { status: 'killed', is_backgrounded: true } }));
    expect(r.detail('tache-1')?.statut).toBe('arretee');
    expect(r.detail('tache-1')?.arrierePlan).toBe(true);
  });

  test('les tâches ambiantes et les messages sur une tâche inconnue sont ignorés', () => {
    const r = registre();
    r.observer(demarrage({ ambient: true, task_id: 'ambiante' }));
    r.observer(message({ type: 'system', subtype: 'task_progress', task_id: 'inconnue', usage: { total_tokens: 1, tool_uses: 0, duration_ms: 0 } }));
    expect(r.liste()).toEqual([]);
    expect(r.detail('ambiante')).toBeNull();
  });

  test('background_tasks_changed marque les tâches encore en arrière-plan', () => {
    const r = registre();
    r.observer(demarrage({ is_backgrounded: false }));
    r.observer(message({ type: 'system', subtype: 'background_tasks_changed', tasks: [{ task_id: 'tache-1' }] }));
    expect(r.detail('tache-1')?.arrierePlan).toBe(true);
  });

  test('les tâches terminées sont plafonnées, les tâches en cours restent', () => {
    const r = registre();
    r.observer(demarrage({ task_id: 'en-cours' }));
    for (let n = 0; n < 60; n += 1) {
      r.observer(demarrage({ task_id: `fini-${n}` }));
      r.observer(message({ type: 'system', subtype: 'task_notification', task_id: `fini-${n}`, status: 'failed', summary: '' }));
    }
    const ids = r.liste().map((tache) => tache.id);
    expect(ids).toContain('en-cours');
    expect(ids.filter((id) => id.startsWith('fini-'))).toHaveLength(50);
    expect(ids).not.toContain('fini-0');
  });
});
